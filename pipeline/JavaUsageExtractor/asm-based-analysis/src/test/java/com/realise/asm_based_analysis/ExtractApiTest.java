package com.realise.asm_based_analysis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.objectweb.asm.ClassWriter;
import org.objectweb.asm.ModuleVisitor;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ExtractApiTest {

    static final String LIB = "org.example.lib.";

    @TempDir
    static Path tmp;
    static Path libClasses;
    static Map<String, ExtractApi.Api> apis;

    @BeforeAll
    static void extract() throws IOException {
        libClasses = AnalyzeUsageTest.compile(AnalyzeUsageTest.FIXTURES.resolve("library"), tmp.resolve("lib"), null);
        Path jar = AnalyzeUsageTest.jar(libClasses, tmp.resolve("lib.jar"));
        apis = ExtractApi.extract(jar).stream().collect(Collectors.toMap(ExtractApi.Api::apiId, Function.identity()));
    }

    static ExtractApi.Api api(String id) {
        ExtractApi.Api api = apis.get(LIB + id);
        assertNotNull(api, "missing API " + id + "\nfound: " + apis.keySet());
        return api;
    }

    @Test
    void includesPublicAndProtectedMembers() {
        assertEquals("constructor", api("Codec.<init>()V").kind());
        assertEquals("protected", api("Codec.<init>(I)V").visibility());
        assertEquals("protected", api("Base.hook()I").visibility());
        assertEquals("method", api("Codec.encode([B)[B").kind());
        assertTrue(api("Codec.create()Lorg/example/lib/Codec;").isStatic());
        assertEquals("field", api("Base.DEFAULT:Ljava/lang/String;").kind());
        assertEquals("interface", api("Encoder.label()Ljava/lang/String;").classKind());
        assertEquals("enum", api("Mode.A:Lorg/example/lib/Mode;").classKind());
        assertTrue(api("Encoder.encode([B)[B").isAbstract());          // interface method without a body
        assertFalse(api("Encoder.label()Ljava/lang/String;").isAbstract());   // default method
        assertTrue(apis.containsKey("org.example.lib.internal.Util.twice(I)I"));
    }

    @Test
    void excludesMembersAndClassesDependentsCannotUse() {
        assertFalse(apis.containsKey(LIB + "Codec.secret()V"));
        assertFalse(apis.containsKey(LIB + "Codec.packagePrivate()V"));
        assertTrue(apis.keySet().stream().noneMatch(k -> k.startsWith(LIB + "Hidden.")));
        assertTrue(apis.keySet().stream().noneMatch(k -> k.contains("PrivateNested")));
        assertTrue(apis.keySet().stream().noneMatch(k -> k.matches(".*\\$\\d+\\..*")));   // anonymous classes
        assertTrue(apis.keySet().stream().noneMatch(k -> k.contains("<clinit>")));
        assertFalse(apis.containsKey(LIB + "Locked.notReachable()V"));                   // protected in a final class
        assertTrue(apis.containsKey(LIB + "Locked.open()V"));
    }

    @Test
    void includesAccessibleNestedClasses() {
        assertEquals("Outer$Nested", api("Outer$Nested.nested()V").className());
        assertTrue(apis.containsKey(LIB + "Outer$ProtectedNested.protectedNested()V"));
    }

    @Test
    void recordsDeprecation() {
        assertTrue(api("Codec.legacyEncode([B)[B").deprecated());
        assertFalse(api("Codec.legacyEncode([B)[B").deprecatedForRemoval());
        assertTrue(api("Codec.OLD_NAME:Ljava/lang/String;").deprecatedForRemoval());
        assertTrue(api("OldApi.run()V").classDeprecated());
        assertFalse(api("Codec.encode([B)[B").deprecated());
    }

    @Test
    void marksPackagesNotExportedByTheModule() throws IOException {
        ClassWriter cw = new ClassWriter(0);
        cw.visit(Opcodes.V9, Opcodes.ACC_MODULE, "module-info", null, null, null);
        ModuleVisitor module = cw.visitModule("org.example.lib", 0, null);
        module.visitExport("org/example/lib", 0);
        module.visitExport("org/example/lib/internal", 0, "some.friend");   // qualified export
        module.visitEnd();
        cw.visitEnd();
        Path withModule = tmp.resolve("lib-module");
        copy(libClasses, withModule);
        Files.createDirectories(withModule.resolve("META-INF/versions/9"));
        Files.write(withModule.resolve("META-INF/versions/9/module-info.class"), cw.toByteArray());

        List<ExtractApi.Api> moduleApis = ExtractApi.extract(AnalyzeUsageTest.jar(withModule, tmp.resolve("lib-module.jar")));
        Map<String, Boolean> exported = moduleApis.stream()
                .collect(Collectors.toMap(ExtractApi.Api::apiId, ExtractApi.Api::exported));
        assertTrue(exported.get(LIB + "Codec.encode([B)[B"));
        assertFalse(exported.get("org.example.lib.internal.Util.twice(I)I"));
    }

    @Test
    void findsOverridesIncludingThroughBridgesAndNonPublicClasses() throws IOException {
        Set<String> overrides = ExtractApi.extractWithOverrides(tmp.resolve("lib.jar")).overrides().stream()
                .map(r -> r[0] + " -> " + r[1]).collect(Collectors.toSet());
        assertTrue(overrides.contains(LIB + "Node.get(Ljava/lang/String;)Lorg/example/lib/Node; -> "
                + LIB + "ObjectNode.get(Ljava/lang/String;)Lorg/example/lib/Node;"));
        assertTrue(overrides.contains(LIB + "Node.size()I -> " + LIB + "ObjectNode.size()I"));
        assertTrue(overrides.contains(LIB + "Handler.handle(Ljava/lang/Object;)V -> "
                + LIB + "StringHandler.handle(Ljava/lang/String;)V"));                 // via the bridge
        assertTrue(overrides.contains(LIB + "Encoder.encode([B)[B -> " + LIB + "Codec.encode([B)[B"));
        assertTrue(overrides.stream().noneMatch(o -> o.endsWith("StringHandler.handle(Ljava/lang/Object;)V")));
    }

    @Test
    void mainWritesCsv() throws IOException {
        Path out = tmp.resolve("out/apis.csv");
        ExtractApi.main(new String[]{"--library-jar", tmp.resolve("lib.jar").toString(), "--out", out.toString()});
        List<String> lines = Files.readAllLines(out);
        assertEquals(String.join(",", ExtractApi.COLUMNS), lines.get(0));
        assertEquals(apis.size() + 1, lines.size());
    }

    static void copy(Path from, Path to) throws IOException {
        try (var files = Files.walk(from)) {
            for (Path p : files.toList()) {
                Path target = to.resolve(from.relativize(p).toString());
                if (Files.isDirectory(p)) Files.createDirectories(target);
                else Files.copy(p, target);
            }
        }
    }
}
