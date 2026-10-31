package com.realise.asm_based_analysis;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Decides whether a reference in a dependent's bytecode is a use of the library,
 * and which class declares the referenced member.
 *
 * A class belongs to the library when its package is one of the packages of the
 * library jar (exact match, so relocated/shaded copies never match). Member
 * references are resolved through the superclass chain and then the interfaces,
 * following both library classes and the dependent's own classes, so that calls
 * made through a subclass are attributed to the declaring library class.
 */
final class UsageResolver {

    /** How the declaring class was found. */
    enum Kind {
        DECLARED,    // declared in the referenced library class itself
        INHERITED,   // referenced on a library class, declared in a library superclass or interface
        SUBCLASS,    // referenced on a dependent class, declared in a library class it extends
        EXTERNAL,    // referenced on a library class, but declared outside the library (e.g. java.lang.Enum)
        UNKNOWN      // library package, but the class or member is not in the library jar
    }

    record Resolution(String declaringClass, Kind kind) {}

    private final ClassIndex library;
    private final Set<String> libraryPackages;
    private final ClassIndex local;

    UsageResolver(ClassIndex library, ClassIndex local) {
        this.library = library;
        this.libraryPackages = library.packages();
        this.local = local;
    }

    boolean isLibraryClass(String internalName) {
        return internalName != null && libraryPackages.contains(ClassIndex.packageOf(internalName));
    }

    Resolution resolveMethod(String owner, String name, String descriptor) {
        return resolve(owner, name + descriptor, true, !name.equals("<init>") && !name.equals("<clinit>"));
    }

    Resolution resolveField(String owner, String name) {
        return resolve(owner, name, false, true);
    }

    /**
     * Returns null when the reference is not a use of the library: the owner is
     * neither a library class nor a dependent class extending one, or the member
     * is declared by the dependent itself.
     */
    private Resolution resolve(String owner, String member, boolean isMethod, boolean inherits) {
        boolean ownerIsLibrary = isLibraryClass(owner);
        if (!ownerIsLibrary && !local.contains(owner)) return null;

        if (!inherits) {
            if (!ownerIsLibrary) return null;
            ClassIndex.ClassInfo info = library.get(owner);
            boolean declared = info != null && declares(info, member, isMethod);
            return new Resolution(owner, declared ? Kind.DECLARED : Kind.UNKNOWN);
        }

        // Superclass chain first: class members take precedence over interface defaults
        List<ClassIndex.ClassInfo> chain = new ArrayList<>();
        String external = null;
        boolean unknownLibraryClass = false;
        for (String c = owner; c != null; ) {
            ClassIndex.ClassInfo info = lookup(c);
            if (info == null) {
                if (isLibraryClass(c)) unknownLibraryClass = true;
                else external = c;
                break;
            }
            if (declares(info, member, isMethod)) return found(owner, info);
            chain.add(info);
            c = info.superName;
        }

        Deque<String> queue = new ArrayDeque<>();
        Set<String> seen = new HashSet<>();
        for (ClassIndex.ClassInfo info : chain) addAll(queue, info.interfaces);
        while (!queue.isEmpty()) {
            String c = queue.poll();
            if (!seen.add(c)) continue;
            ClassIndex.ClassInfo info = lookup(c);
            if (info == null) {
                if (isLibraryClass(c)) unknownLibraryClass = true;
                continue;
            }
            if (declares(info, member, isMethod)) return found(owner, info);
            addAll(queue, info.interfaces);
        }

        if (!ownerIsLibrary) return null;
        if (unknownLibraryClass || external == null) return new Resolution(owner, Kind.UNKNOWN);
        return new Resolution(external, Kind.EXTERNAL);
    }

    private Resolution found(String owner, ClassIndex.ClassInfo declaring) {
        if (!isLibraryClass(declaring.name)) return null;   // declared by the dependent itself
        if (declaring.name.equals(owner)) return new Resolution(owner, Kind.DECLARED);
        return new Resolution(declaring.name, isLibraryClass(owner) ? Kind.INHERITED : Kind.SUBCLASS);
    }

    /** Library classes come from the library jar, even if the dependent bundles a copy. */
    private ClassIndex.ClassInfo lookup(String internalName) {
        if (isLibraryClass(internalName)) return library.get(internalName);
        return local.get(internalName);
    }

    private static boolean declares(ClassIndex.ClassInfo info, String member, boolean isMethod) {
        return isMethod ? info.methods.contains(member) : info.fields.contains(member);
    }

    private static void addAll(Deque<String> queue, String[] names) {
        for (String n : names) queue.add(n);
    }
}
