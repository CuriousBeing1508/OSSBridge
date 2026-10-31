package com.realise.asm_based_analysis;

import org.objectweb.asm.AnnotationVisitor;
import org.objectweb.asm.ClassVisitor;
import org.objectweb.asm.FieldVisitor;
import org.objectweb.asm.Handle;
import org.objectweb.asm.Label;
import org.objectweb.asm.MethodVisitor;
import org.objectweb.asm.Opcodes;
import org.objectweb.asm.Type;

/**
 * Records the library usages in one class of a dependent jar.
 *
 * Categories:
 *   METHOD_CALL       invoke instruction (constructors are member <init>)
 *   METHOD_REFERENCE  method handle in invokedynamic, e.g. Hex::encodeHex
 *   FIELD_ACCESS      get/put of a field
 *   TYPE_REFERENCE    new, checkcast, instanceof, array creation
 *   CLASS_CONSTANT    Foo.class literal
 *   CLASS_USAGE       extends / implements (member <extends> or <implements>)
 *   ANNOTATION        annotation on a class, field, method or parameter
 *   FIELD_TYPE        field declared with a library type
 *
 * Classes of the dependent that are in a library package (a bundled copy of the
 * library) are skipped entirely.
 */
final class DependentClassVisitor extends ClassVisitor {

    private final UsageResolver resolver;
    private final UsageCollector collector;
    private final long[] instructions;
    private String currentClass;
    private boolean bundledLibraryClass;

    DependentClassVisitor(UsageResolver resolver, UsageCollector collector, long[] instructions) {
        super(Opcodes.ASM9);
        this.resolver = resolver;
        this.collector = collector;
        this.instructions = instructions;
    }

    boolean isBundledLibraryClass() {
        return bundledLibraryClass;
    }

    @Override
    public void visit(int version, int access, String name, String signature,
                      String superName, String[] interfaces) {
        currentClass = dotted(name);
        bundledLibraryClass = resolver.isLibraryClass(name);
        if (bundledLibraryClass) return;
        typeUse("CLASS_USAGE", superName, "<extends>");
        if (interfaces != null) {
            for (String iface : interfaces) typeUse("CLASS_USAGE", iface, "<implements>");
        }
    }

    @Override
    public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
        if (!bundledLibraryClass) annotation(descriptor);
        return null;
    }

    @Override
    public FieldVisitor visitField(int access, String name, String descriptor,
                                   String signature, Object value) {
        if (bundledLibraryClass) return null;
        typeUse("FIELD_TYPE", objectType(Type.getType(descriptor)), null);
        return new FieldVisitor(Opcodes.ASM9) {
            @Override
            public AnnotationVisitor visitAnnotation(String desc, boolean visible) {
                annotation(desc);
                return null;
            }
        };
    }

    @Override
    public MethodVisitor visitMethod(int access, String name, String descriptor,
                                     String signature, String[] exceptions) {
        if (bundledLibraryClass) return null;
        return new MethodVisitor(Opcodes.ASM9) {

            @Override
            public AnnotationVisitor visitAnnotation(String desc, boolean visible) {
                annotation(desc);
                return null;
            }

            @Override
            public AnnotationVisitor visitParameterAnnotation(int parameter, String desc, boolean visible) {
                annotation(desc);
                return null;
            }

            @Override
            public void visitMethodInsn(int opcode, String owner, String methodName,
                                        String methodDesc, boolean isInterface) {
                instructions[0]++;
                methodUse("METHOD_CALL", owner, methodName, methodDesc);
            }

            @Override
            public void visitFieldInsn(int opcode, String owner, String fieldName, String fieldDesc) {
                instructions[0]++;
                fieldUse(owner, fieldName, fieldDesc);
            }

            @Override
            public void visitTypeInsn(int opcode, String type) {
                instructions[0]++;
                typeUse("TYPE_REFERENCE", objectType(Type.getObjectType(type)), null);
            }

            @Override
            public void visitMultiANewArrayInsn(String desc, int dims) {
                instructions[0]++;
                typeUse("TYPE_REFERENCE", objectType(Type.getType(desc)), null);
            }

            @Override
            public void visitLdcInsn(Object value) {
                instructions[0]++;
                if (value instanceof Type type && (type.getSort() == Type.OBJECT || type.getSort() == Type.ARRAY)) {
                    typeUse("CLASS_CONSTANT", objectType(type), null);
                } else if (value instanceof Handle handle) {
                    handleUse(handle);
                }
            }

            @Override
            public void visitInvokeDynamicInsn(String indyName, String indyDesc, Handle bsm, Object... bsmArgs) {
                instructions[0]++;
                for (Object arg : bsmArgs) {
                    if (arg instanceof Handle handle) handleUse(handle);
                }
            }

            @Override public void visitInsn(int opcode) { instructions[0]++; }
            @Override public void visitIntInsn(int opcode, int operand) { instructions[0]++; }
            @Override public void visitVarInsn(int opcode, int var) { instructions[0]++; }
            @Override public void visitJumpInsn(int opcode, Label label) { instructions[0]++; }
            @Override public void visitIincInsn(int var, int increment) { instructions[0]++; }
            @Override public void visitTableSwitchInsn(int min, int max, Label dflt, Label... labels) { instructions[0]++; }
            @Override public void visitLookupSwitchInsn(Label dflt, int[] keys, Label[] labels) { instructions[0]++; }
        };
    }

    private void annotation(String descriptor) {
        typeUse("ANNOTATION", objectType(Type.getType(descriptor)), null);
    }

    private void handleUse(Handle handle) {
        int tag = handle.getTag();
        if (tag >= Opcodes.H_GETFIELD && tag <= Opcodes.H_PUTSTATIC) {
            fieldUse(handle.getOwner(), handle.getName(), handle.getDesc());
        } else {
            methodUse("METHOD_REFERENCE", handle.getOwner(), handle.getName(), handle.getDesc());
        }
    }

    private void methodUse(String category, String owner, String name, String descriptor) {
        if (owner.startsWith("[")) return;   // methods of array types (clone) are JDK methods
        UsageResolver.Resolution r = resolver.resolveMethod(owner, name, descriptor);
        if (r != null) record(category, owner, name, descriptor, r);
    }

    private void fieldUse(String owner, String name, String descriptor) {
        UsageResolver.Resolution r = resolver.resolveField(owner, name);
        if (r != null) record("FIELD_ACCESS", owner, name, descriptor, r);
    }

    private void typeUse(String category, String internalName, String member) {
        if (internalName == null || !resolver.isLibraryClass(internalName)) return;
        collector.add(new UsageCollector.Key(category, dotted(internalName), member, null, null, null),
                currentClass);
    }

    private void record(String category, String owner, String name, String descriptor,
                        UsageResolver.Resolution r) {
        collector.add(new UsageCollector.Key(category, dotted(owner), name, descriptor,
                dotted(r.declaringClass()), r.kind().name().toLowerCase()), currentClass);
    }

    /** Internal name of an object type, or of the element type of an array; null for primitives. */
    private static String objectType(Type type) {
        if (type.getSort() == Type.ARRAY) type = type.getElementType();
        return type.getSort() == Type.OBJECT ? type.getInternalName() : null;
    }

    private static String dotted(String internalName) {
        return internalName == null ? null : internalName.replace('/', '.');
    }
}
