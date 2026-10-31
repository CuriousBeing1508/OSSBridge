package com.realise.asm_based_analysis;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import javax.tools.JavaCompiler;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarOutputStream;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Compiles a small library and a dependent from src/test/resources/fixtures and analyzes them. */
class AnalyzeUsageTest {

    static final Path FIXTURES = Paths.get("src/test/resources/fixtures");

    @TempDir
    static Path tmp;
    static Path libraryJar;
    static Path dependentJar;
    static AnalyzeUsage.JarResult result;
    static Map<String, Map.Entry<UsageCollector.Key, UsageCollector.Stats>> usages;

    @BeforeAll
    static void compileAndAnalyze() throws IOException {
        Path libClasses = compile(FIXTURES.resolve("library"), tmp.resolve("lib-classes"), null);
        libraryJar = jar(libClasses, tmp.resolve("lib.jar"));
        Path depClasses = compile(FIXTURES.resolve("dependent"), tmp.resolve("dep-classes"), libClasses);
        Files.createDirectories(tmp.resolve("dependents"));
        dependentJar = jar(depClasses, tmp.resolve("dependents/com_acme-app-1.0.jar"));

        result = AnalyzeUsage.analyzeJar(dependentJar, ClassIndex.ofJar(libraryJar));
        usages = new HashMap<>();
        for (Map.Entry<UsageCollector.Key, UsageCollector.Stats> e : result.usages().usages().entrySet()) {
            UsageCollector.Key k = e.getKey();
            usages.put(k.category() + " " + k.targetClass() + " " + k.member() + " " + k.descriptor(), e);
        }
    }

    static Map.Entry<UsageCollector.Key, UsageCollector.Stats> usage(String key) {
        Map.Entry<UsageCollector.Key, UsageCollector.Stats> e = usages.get(key);
        assertNotNull(e, "missing usage: " + key + "\nfound: " + usages.keySet());
        return e;
    }

    static void assertResolved(String key, String declaringClass, String resolution) {
        UsageCollector.Key k = usage(key).getKey();
        assertEquals(declaringClass, k.declaringClass(), key);
        assertEquals(resolution, k.resolution(), key);
    }

    @Test
    void countsEveryCallSite() {
        Map.Entry<UsageCollector.Key, UsageCollector.Stats> encode =
                usage("METHOD_CALL org.example.lib.Codec encode ([B)[B");
        assertEquals(3, encode.getValue().occurrences);          // twice in App, once in Other
        assertEquals(2, encode.getValue().callerClasses.size());
        assertResolved("METHOD_CALL org.example.lib.Codec encode ([B)[B", "org.example.lib.Codec", "declared");
    }

    @Test
    void resolvesInheritedMembersToTheDeclaringClass() {
        assertResolved("METHOD_CALL org.example.lib.Codec hello (Ljava/lang/String;)Ljava/lang/String;",
                "org.example.lib.Base", "inherited");
        assertResolved("METHOD_CALL org.example.lib.Codec label ()Ljava/lang/String;",
                "org.example.lib.Encoder", "inherited");
        assertResolved("FIELD_ACCESS org.example.lib.Codec DEFAULT Ljava/lang/String;",
                "org.example.lib.Base", "inherited");
    }

    @Test
    void attributesCallsThroughADependentSubclass() {
        assertResolved("METHOD_CALL com.acme.App hello (Ljava/lang/String;)Ljava/lang/String;",
                "org.example.lib.Base", "subclass");
        assertResolved("METHOD_CALL com.acme.App hook ()I", "org.example.lib.Base", "subclass");
        assertResolved("METHOD_CALL org.example.lib.Codec <init> (I)V", "org.example.lib.Codec", "declared");
    }

    @Test
    void ignoresTheDependentsOwnAndJdkMembers() {
        assertFalse(usages.containsKey("METHOD_CALL com.acme.App encode ([B)[B"));
        assertFalse(usages.containsKey("METHOD_CALL com.acme.App toString ()Ljava/lang/String;"));
        assertResolved("METHOD_CALL org.example.lib.Mode ordinal ()I", "java.lang.Enum", "external");
    }

    @Test
    void recordsMethodReferencesTypesAndAnnotations() {
        assertResolved("METHOD_REFERENCE org.example.lib.Codec encode ([B)[B", "org.example.lib.Codec", "declared");
        usage("TYPE_REFERENCE org.example.lib.Codec null null");
        usage("CLASS_CONSTANT org.example.lib.Codec null null");
        usage("CLASS_USAGE org.example.lib.Codec <extends> null");
        usage("CLASS_USAGE org.example.lib.Encoder <implements> null");
        usage("FIELD_TYPE org.example.lib.Mode null null");
        usage("FIELD_TYPE org.example.lib.Codec null null");
        assertEquals(3, usage("ANNOTATION org.example.lib.Marker null null").getValue().occurrences);
        assertResolved("METHOD_CALL org.example.lib.internal.Util twice (I)I",
                "org.example.lib.internal.Util", "declared");
    }

    @Test
    void skipsBundledLibraryClassesAndShadedCopies() {
        assertEquals(1, result.bundledClasses());
        assertTrue(usages.values().stream().noneMatch(e -> e.getValue().callerClasses.contains("org.example.lib.Bundled")));
        assertTrue(usages.keySet().stream().noneMatch(k -> k.contains("shaded")));
    }

    @Test
    void mainWritesUsageAndSummaryCsv() throws IOException {
        Path usageCsv = tmp.resolve("out/usage.csv");
        Path summaryCsv = tmp.resolve("out/summary.csv");
        Files.writeString(tmp.resolve("dependents/broken.jar"), "not a jar");
        AnalyzeUsage.main(new String[]{"--library-jar", libraryJar.toString(),
                "--dependents-dir", tmp.resolve("dependents").toString(),
                "--usage-out", usageCsv.toString(), "--summary-out", summaryCsv.toString()});

        List<String> usageLines = Files.readAllLines(usageCsv);
        assertEquals(String.join(",", AnalyzeUsage.USAGE_COLUMNS), usageLines.get(0));
        assertEquals(result.usages().usages().size() + 1, usageLines.size());

        List<String> summary = Files.readAllLines(summaryCsv);
        assertEquals(3, summary.size());
        assertTrue(summary.get(1).startsWith("broken.jar,error,"));
        assertTrue(summary.get(2).startsWith("com_acme-app-1.0.jar,analyzed,"));
        assertFalse(Files.exists(tmp.resolve("out/usage.csv.tmp")));
    }

    @Test
    void jarListAnalyzesOnlyTheListedJars() throws IOException {
        Path list = tmp.resolve("batch.txt");
        Files.writeString(list, dependentJar + "\n\n");
        Path summaryCsv = tmp.resolve("out/batch-summary.csv");
        AnalyzeUsage.main(new String[]{"--library-jar", libraryJar.toString(), "--jar-list", list.toString(),
                "--usage-out", tmp.resolve("out/batch-usage.csv").toString(), "--summary-out", summaryCsv.toString()});

        List<String> summary = Files.readAllLines(summaryCsv);
        assertEquals(2, summary.size());
        assertTrue(summary.get(1).startsWith("com_acme-app-1.0.jar,analyzed,"));
    }

    @Test
    void countsAllBytecodeInstructions() {
        assertTrue(result.instructions() > 40, "instructions: " + result.instructions());
        assertEquals("", result.detail());
    }

    static Path compile(Path sourceRoot, Path out, Path classpath) throws IOException {
        Files.createDirectories(out);
        List<String> args = new ArrayList<>(List.of("--release", "17", "-d", out.toString()));
        if (classpath != null) args.addAll(List.of("-cp", classpath.toString()));
        try (Stream<Path> files = Files.walk(sourceRoot)) {
            files.filter(p -> p.toString().endsWith(".java")).forEach(p -> args.add(p.toString()));
        }
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        assertEquals(0, javac.run(null, null, null, args.toArray(new String[0])), "compilation failed");
        return out;
    }

    static Path jar(Path classesDir, Path jarPath) throws IOException {
        try (OutputStream out = Files.newOutputStream(jarPath);
             JarOutputStream jar = new JarOutputStream(out);
             Stream<Path> files = Files.walk(classesDir)) {
            for (Path p : files.filter(Files::isRegularFile).sorted().toList()) {
                jar.putNextEntry(new JarEntry(classesDir.relativize(p).toString().replace('\\', '/')));
                jar.write(Files.readAllBytes(p));
                jar.closeEntry();
            }
        }
        return jarPath;
    }
}
