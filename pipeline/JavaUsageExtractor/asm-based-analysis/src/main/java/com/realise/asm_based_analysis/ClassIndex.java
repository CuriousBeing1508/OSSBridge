package com.realise.asm_based_analysis;

import org.objectweb.asm.ClassReader;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.Collection;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;

/**
 * Class headers of a jar: superclass, interfaces and declared members.
 * Names are JVM internal names (a/b/C).
 */
final class ClassIndex {

    static final class ClassInfo {
        final String name;
        final String superName;
        final String[] interfaces;
        final int access;
        final Set<String> methods = new HashSet<>();   // name + descriptor
        final Set<String> fields = new HashSet<>();    // name

        ClassInfo(String name, String superName, String[] interfaces, int access) {
            this.name = name;
            this.superName = superName;
            this.interfaces = interfaces == null ? new String[0] : interfaces;
            this.access = access;
        }
    }

    private final Map<String, ClassInfo> classes = new HashMap<>();

    /** Index the classes of a jar. Multi-release copies, module-info and package-info are skipped. */
    static ClassIndex ofJar(Path jar) throws IOException {
        ClassIndex index = new ClassIndex();
        try (JarFile jarFile = new JarFile(jar.toFile())) {
            Enumeration<JarEntry> entries = jarFile.entries();
            while (entries.hasMoreElements()) {
                JarEntry entry = entries.nextElement();
                if (!isAnalyzableClass(entry.getName())) continue;
                try (InputStream in = jarFile.getInputStream(entry)) {
                    index.add(new ClassReader(in));
                } catch (IllegalArgumentException | ArrayIndexOutOfBoundsException e) {
                    // Class file version newer than ASM supports, or a corrupt entry
                }
            }
        }
        return index;
    }

    static boolean isAnalyzableClass(String entryName) {
        return entryName.endsWith(".class")
                && !entryName.startsWith("META-INF/")
                && !entryName.endsWith("module-info.class")
                && !entryName.endsWith("package-info.class");
    }

    void add(ClassReader reader) {
        reader.accept(new ClassVisitor(Opcodes.ASM9) {
            ClassInfo info;

            @Override
            public void visit(int version, int access, String name, String signature,
                              String superName, String[] interfaces) {
                info = new ClassInfo(name, superName, interfaces, access);
                classes.put(name, info);
            }

            @Override
            public MethodVisitor visitMethod(int access, String name, String descriptor,
                                             String signature, String[] exceptions) {
                info.methods.add(name + descriptor);
                return null;
            }

            @Override
            public FieldVisitor visitField(int access, String name, String descriptor,
                                           String signature, Object value) {
                info.fields.add(name);
                return null;
            }
        }, ClassReader.SKIP_CODE | ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
    }

    ClassInfo get(String internalName) {
        return classes.get(internalName);
    }

    boolean contains(String internalName) {
        return classes.containsKey(internalName);
    }

    Collection<ClassInfo> all() {
        return classes.values();
    }

    /** Packages of the indexed classes, in internal form (a/b). */
    Set<String> packages() {
        Set<String> packages = new TreeSet<>();
        for (String name : classes.keySet()) packages.add(packageOf(name));
        return packages;
    }

    static String packageOf(String internalName) {
        int i = internalName.lastIndexOf('/');
        return i < 0 ? "" : internalName.substring(0, i);
    }
}
