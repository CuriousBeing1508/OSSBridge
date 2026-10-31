package com.realise.asm_based_analysis;

import org.objectweb.asm.AnnotationVisitor;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.ModuleVisitor;
import org.objectweb.asm.Opcodes;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * Pipeline step 4: the API of a library jar, i.e. the members a dependent can use.
 *
 * Usage:
 *   java -cp ossbridge-usage-analyzer.jar com.realise.asm_based_analysis.ExtractApi
 *        --library-jar LIB.jar --out apis.csv [--overrides-out api-overrides.csv]
 *
 * api-overrides.csv lists, for each API method, the methods of the library that
 * override or implement it (in any class, public or not), so coverage can follow
 * virtual dispatch: a call to JsonNode.get(String) runs ObjectNode.get(String).
 * Compiler-generated bridge methods (generics) are followed to the method they call.
 *
 * A class is part of the API when it is public (top-level) or a public/protected
 * nested class of an API class; anonymous and local classes are not. Its public
 * members are API, and so are its protected members unless the class is final
 * (protected members are used by subclasses). Synthetic and bridge methods and
 * static initializers are skipped.
 *
 * api_id is "<package>.<Class>.<member><descriptor>" for methods and constructors
 * (member <init>) and "<package>.<Class>.<field>:<descriptor>" for fields, matching
 * the usage analysis output.
 *
 * apis.csv columns: api_id, package, class_name, member, descriptor, kind
 * (method|constructor|field), visibility (public|protected), static, abstract (abstract or
 * native: no bytecode, so no coverage), class_kind
 * (class|interface|enum|annotation|record), deprecated, deprecated_for_removal,
 * class_deprecated, exported (false when a module-info does not export the package)
 */
public final class ExtractApi {

    static final String[] COLUMNS = {"api_id", "package", "class_name", "member", "descriptor", "kind",
            "visibility", "static", "abstract", "class_kind", "deprecated", "deprecated_for_removal", "class_deprecated",
            "exported"};

    static final class Member {
        final String name;
        final String descriptor;
        final int access;
        final boolean isField;
        final Deprecation deprecation = new Deprecation();

        Member(String name, String descriptor, int access, boolean isField) {
            this.name = name;
            this.descriptor = descriptor;
            this.access = access;
            this.isField = isField;
        }
    }

    static final class Deprecation {
        boolean deprecated;
        boolean forRemoval;
    }

    static final class ClassModel {
        String name;
        String superName;
        String[] interfaces = new String[0];
        int access;
        Integer innerAccess;       // access flags from the InnerClasses attribute, if nested
        String outerName;
        boolean localOrAnonymous;
        final Deprecation deprecation = new Deprecation();
        final List<Member> members = new ArrayList<>();
        final Map<String, String> bridges = new HashMap<>();   // bridge name+desc -> name+desc it calls

        Member declared(String nameAndDesc) {
            for (Member m : members) {
                if (!m.isField && (m.name + m.descriptor).equals(nameAndDesc)) return m;
            }
            return null;
        }
    }

    record Extraction(List<Api> apis, List<String[]> overrides) {}

    record Api(String apiId, String pkg, String className, String member, String descriptor, String kind,
               String visibility, boolean isStatic, boolean isAbstract, String classKind, boolean deprecated,
               boolean deprecatedForRemoval, boolean classDeprecated, boolean exported) {}

    public static void main(String[] args) throws IOException {
        Map<String, String> opts = new HashMap<>();
        for (int i = 0; i + 1 < args.length; i += 2) opts.put(args[i], args[i + 1]);
        if (!opts.containsKey("--library-jar") || !opts.containsKey("--out")) {
            System.err.println("Usage: java -cp ossbridge-usage-analyzer.jar "
                    + "com.realise.asm_based_analysis.ExtractApi --library-jar LIB.jar --out apis.csv");
            System.exit(2);
        }
        Extraction extraction = extractWithOverrides(Paths.get(opts.get("--library-jar")));
        List<Api> apis = extraction.apis();
        if (apis.isEmpty()) {
            System.err.println("No API found in " + opts.get("--library-jar"));
            System.exit(1);
        }
        Path out = Paths.get(opts.get("--out"));
        Path parent = out.toAbsolutePath().getParent();
        Files.createDirectories(parent);
        Path tmp = parent.resolve(out.getFileName() + ".tmp");
        try (BufferedWriter writer = Files.newBufferedWriter(tmp)) {
            AnalyzeUsage.writeRow(writer, COLUMNS);
            for (Api a : apis) {
                AnalyzeUsage.writeRow(writer, new String[]{a.apiId(), a.pkg(), a.className(), a.member(),
                        a.descriptor(), a.kind(), a.visibility(), String.valueOf(a.isStatic()),
                        String.valueOf(a.isAbstract()), a.classKind(),
                        String.valueOf(a.deprecated()), String.valueOf(a.deprecatedForRemoval()),
                        String.valueOf(a.classDeprecated()), String.valueOf(a.exported())});
            }
        }
        Files.move(tmp, out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        System.out.println("APIs: " + apis.size());

        if (opts.containsKey("--overrides-out")) {
            Path overridesOut = Paths.get(opts.get("--overrides-out"));
            Path overridesTmp = parent.resolve(overridesOut.getFileName() + ".tmp");
            try (BufferedWriter writer = Files.newBufferedWriter(overridesTmp)) {
                AnalyzeUsage.writeRow(writer, new String[]{"api_id", "override_id"});
                for (String[] row : extraction.overrides()) AnalyzeUsage.writeRow(writer, row);
            }
            Files.move(overridesTmp, overridesOut, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            System.out.println("Overrides: " + extraction.overrides().size());
        }
    }

    static List<Api> extract(Path jar) throws IOException {
        return extractWithOverrides(jar).apis();
    }

    static Extraction extractWithOverrides(Path jar) throws IOException {
        Map<String, ClassModel> classes = new HashMap<>();
        Set<String> exportedPackages = null;   // null: no module-info, everything is exported
        try (JarFile jarFile = new JarFile(jar.toFile())) {
            Enumeration<JarEntry> entries = jarFile.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                String name = entry.getName();
                try (InputStream in = jarFile.getInputStream(entry)) {
                    if (name.endsWith("module-info.class")) {
                        if (exportedPackages == null) exportedPackages = new HashSet<>();
                        readExports(new ClassReader(in), exportedPackages);
                    } else if (ClassIndex.isAnalyzableClass(name)) {
                        ClassModel model = read(new ClassReader(in));
                        classes.put(model.name, model);
                    }
                } catch (IllegalArgumentException | ArrayIndexOutOfBoundsException e) {
                    // Class file version newer than ASM supports, or a corrupt entry
                }
            }
        }

        List<Api> apis = new ArrayList<>();
        Map<String, Boolean> accessible = new HashMap<>();
        for (ClassModel c : classes.values()) {
            if (!isAccessible(c, classes, accessible)) continue;
            String pkg = ClassIndex.packageOf(c.name).replace('/', '.');
            String className = c.name.substring(c.name.lastIndexOf('/') + 1);
            String qualified = c.name.replace('/', '.');
            boolean exported = exportedPackages == null || exportedPackages.contains(ClassIndex.packageOf(c.name));
            boolean finalClass = (c.access & Opcodes.ACC_FINAL) != 0;
            boolean classDeprecated = c.deprecation.deprecated || (c.access & Opcodes.ACC_DEPRECATED) != 0;
            for (Member m : c.members) {
                String visibility = (m.access & Opcodes.ACC_PUBLIC) != 0 ? "public"
                        : (m.access & Opcodes.ACC_PROTECTED) != 0 && !finalClass ? "protected" : null;
                if (visibility == null) continue;
                String kind = m.isField ? "field" : m.name.equals("<init>") ? "constructor" : "method";
                String apiId = qualified + "." + m.name + (m.isField ? ":" : "") + m.descriptor;
                boolean deprecated = m.deprecation.deprecated || (m.access & Opcodes.ACC_DEPRECATED) != 0;
                apis.add(new Api(apiId, pkg, className, m.name, m.descriptor, kind, visibility,
                        (m.access & Opcodes.ACC_STATIC) != 0,
                        (m.access & (Opcodes.ACC_ABSTRACT | Opcodes.ACC_NATIVE)) != 0, classKind(c), deprecated, m.deprecation.forRemoval,
                        classDeprecated, exported));
            }
        }
        apis.sort(Comparator.comparing(Api::apiId));
        return new Extraction(apis, overrides(apis, classes));
    }

    /** (api_id, override_id) for every API method and each library method that overrides it. */
    static List<String[]> overrides(List<Api> apis, Map<String, ClassModel> classes) {
        Map<String, List<String>> subtypes = new HashMap<>();
        for (ClassModel c : classes.values()) {
            if (c.superName != null) subtypes.computeIfAbsent(c.superName, k -> new ArrayList<>()).add(c.name);
            for (String i : c.interfaces) subtypes.computeIfAbsent(i, k -> new ArrayList<>()).add(c.name);
        }
        List<String[]> rows = new ArrayList<>();
        for (Api api : apis) {
            if (!api.kind().equals("method") || api.isStatic()) continue;
            String owner = (api.pkg().isEmpty() ? "" : api.pkg().replace('.', '/') + "/") + api.className();
            String key = api.member() + api.descriptor();
            ArrayDeque<String> queue = new ArrayDeque<>(subtypes.getOrDefault(owner, List.of()));
            Set<String> seen = new HashSet<>();
            while (!queue.isEmpty()) {
                String sub = queue.poll();
                if (!seen.add(sub)) continue;
                ClassModel d = classes.get(sub);
                if (d == null) continue;
                String target = d.bridges.getOrDefault(key, key);
                Member m = d.declared(target);
                if (m != null && (m.access & (Opcodes.ACC_STATIC | Opcodes.ACC_PRIVATE | Opcodes.ACC_ABSTRACT)) == 0) {
                    rows.add(new String[]{api.apiId(), sub.replace('/', '.') + "." + target});
                }
                queue.addAll(subtypes.getOrDefault(sub, List.of()));
            }
        }
        return rows;
    }

    /** Top-level: public. Nested: public or protected, not local/anonymous, inside an accessible class. */
    private static boolean isAccessible(ClassModel c, Map<String, ClassModel> classes, Map<String, Boolean> memo) {
        Boolean known = memo.get(c.name);
        if (known != null) return known;
        boolean result;
        if ((c.access & Opcodes.ACC_SYNTHETIC) != 0 || (c.access & Opcodes.ACC_PUBLIC) == 0) {
            result = false;
        } else if (c.innerAccess == null) {
            result = true;
        } else if (c.localOrAnonymous || (c.innerAccess & (Opcodes.ACC_PUBLIC | Opcodes.ACC_PROTECTED)) == 0) {
            result = false;
        } else {
            ClassModel outer = classes.get(c.outerName);
            result = outer != null && isAccessible(outer, classes, memo);
        }
        memo.put(c.name, result);
        return result;
    }

    private static String classKind(ClassModel c) {
        if ((c.access & Opcodes.ACC_ANNOTATION) != 0) return "annotation";
        if ((c.access & Opcodes.ACC_INTERFACE) != 0) return "interface";
        if ((c.access & Opcodes.ACC_ENUM) != 0) return "enum";
        if ("java/lang/Record".equals(c.superName)) return "record";
        return "class";
    }

    private static ClassModel read(ClassReader reader) {
        ClassModel model = new ClassModel();
        reader.accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public void visit(int version, int access, String name, String signature,
                              String superName, String[] interfaces) {
                model.name = name;
                model.superName = superName;
                model.interfaces = interfaces == null ? new String[0] : interfaces;
                model.access = access;
            }

            @Override
            public void visitInnerClass(String name, String outerName, String innerName, int access) {
                if (name.equals(model.name)) {
                    model.innerAccess = access;
                    model.outerName = outerName;
                    model.localOrAnonymous = outerName == null || innerName == null;
                }
            }

            @Override
            public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
                return deprecationVisitor(descriptor, model.deprecation);
            }

            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                if ((access & Opcodes.ACC_BRIDGE) != 0) {
                    // A bridge calls the real method of the same class: remember which one
                    return new MethodVisitor(Opcodes.ASM9) {
                        @Override
                        public void visitMethodInsn(int opcode, String owner, String mName, String mDesc,
                                                    boolean isInterface) {
                            if (owner.equals(model.name) && mName.equals(name)) {
                                model.bridges.putIfAbsent(name + descriptor, mName + mDesc);
                            }
                        }
                    };
                }
                if ((access & Opcodes.ACC_SYNTHETIC) != 0 || name.equals("<clinit>")) {
                    return null;
                }
                Member member = new Member(name, descriptor, access, false);
                model.members.add(member);
                return new MethodVisitor(Opcodes.ASM9) {
                    @Override
                    public AnnotationVisitor visitAnnotation(String desc, boolean visible) {
                        return deprecationVisitor(desc, member.deprecation);
                    }
                };
            }

            @Override
            public FieldVisitor visitField(int access, String name, String descriptor,
                                           String signature, Object value) {
                if ((access & Opcodes.ACC_SYNTHETIC) != 0) return null;
                Member member = new Member(name, descriptor, access, true);
                model.members.add(member);
                return new FieldVisitor(Opcodes.ASM9) {
                    @Override
                    public AnnotationVisitor visitAnnotation(String desc, boolean visible) {
                        return deprecationVisitor(desc, member.deprecation);
                    }
                };
            }
        }, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);   // code is read for bridge methods only
        return model;
    }

    /** Records @Deprecated and its forRemoval element. */
    private static AnnotationVisitor deprecationVisitor(String descriptor, Deprecation deprecation) {
        if (!"Ljava/lang/Deprecated;".equals(descriptor)) return null;
        deprecation.deprecated = true;
        return new AnnotationVisitor(Opcodes.ASM9) {
            @Override
            public void visit(String name, Object value) {
                if ("forRemoval".equals(name) && Boolean.TRUE.equals(value)) deprecation.forRemoval = true;
            }
        };
    }

    /** Packages exported to every module (qualified exports are not counted). */
    private static void readExports(ClassReader reader, Set<String> exported) {
        reader.accept(new ClassVisitor(Opcodes.ASM9) {
            @Override
            public ModuleVisitor visitModule(String name, int access, String version) {
                return new ModuleVisitor(Opcodes.ASM9) {
                    @Override
                    public void visitExport(String packaze, int exportAccess, String... modules) {
                        if (modules == null || modules.length == 0) exported.add(packaze);
                    }
                };
            }
        }, 0);
    }
}
