package com.realise.asm_based_analysis;

import org.objectweb.asm.*;

import java.util.List;
import java.util.Set;

public class ThirdPartyClassVisitor extends ClassVisitor {
    private final Set<String> seenCalls;
    private final List<String[]> csvRows;
    private final int[] totalInstructions;
    private final String jarFileName;
    private final Set<String> targetApiPackages;

    private String currentClass;

    public ThirdPartyClassVisitor(
            String basePackage,
            Set<String> seenCalls,
            List<String[]> csvRows,
            int[] totalInstructions,
            String jarFileName,
            Set<String> targetApiPackages) {
        super(Opcodes.ASM9);
        this.seenCalls = seenCalls;
        this.csvRows = csvRows;
        this.totalInstructions = totalInstructions;
        this.jarFileName = jarFileName;
        this.targetApiPackages = targetApiPackages;
    }

    @Override
    public void visit(int version, int access, String name, String signature, String superName, String[] interfaces) {
        currentClass = name.replace('/', '.');
        checkTypeUsage(superName, "<extends>");
        if (interfaces != null) {
            for (String iface : interfaces) {
                checkTypeUsage(iface, "<implements>");
            }
        }
    }

    @Override
    public AnnotationVisitor visitAnnotation(String descriptor, boolean visible) {
        String type = Type.getType(descriptor).getClassName();
        if (isTargetApiType(type) && seenCalls.add(type + ":ANNOTATION")) {
            csvRows.add(new String[]{jarFileName, currentClass, type, "ANNOTATION"});
        }
        return super.visitAnnotation(descriptor, visible);
    }

    @Override
    public FieldVisitor visitField(int access, String name, String descriptor, String signature, Object value) {
        String type = Type.getType(descriptor).getClassName();
        if (isTargetApiType(type) && (access & Opcodes.ACC_FINAL) != 0) {
            String usage = type + " " + name;
            if (seenCalls.add(usage)) {
                csvRows.add(new String[]{jarFileName, currentClass, usage, "FINAL_FIELD"});
            }
        }
        return super.visitField(access, name, descriptor, signature, value);
    }

    @Override
    public MethodVisitor visitMethod(int access, String name, String descriptor, String signature, String[] exceptions) {
        return new MethodVisitor(Opcodes.ASM9) {

            @Override
            public void visitMethodInsn(int opcode, String owner, String methodName, String methodDesc, boolean itf) {
                totalInstructions[0]++;
                processUsage(owner, methodName, methodDesc, "METHOD_CALL");
            }

            @Override
            public void visitFieldInsn(int opcode, String owner, String fieldName, String descriptor) {
                totalInstructions[0]++;
                processUsage(owner, fieldName, descriptor, "FIELD_ACCESS");
            }

            @Override
            public void visitTypeInsn(int opcode, String type) {
                totalInstructions[0]++;
                String className = Type.getObjectType(type).getClassName();
                processUsageDirect(className, "TYPE_REFERENCE");
            }

            @Override
            public void visitLdcInsn(Object value) {
                if (value instanceof Type) {
                    totalInstructions[0]++;
                    String className = ((Type) value).getClassName();
                    processUsageDirect(className, "CLASS_CONSTANT");
                }
            }

            private void processUsage(String rawOwner, String name, String desc, String usageType) {
                String ownerClass = cleanType(rawOwner);
                if (!isTargetApiType(ownerClass)) return;

                String signature = ownerClass + "." + name + (desc.isEmpty() ? "" : " : " + desc);
                if (seenCalls.add(signature)) {
                    csvRows.add(new String[]{jarFileName, currentClass, signature, usageType});
                }
            }

            private void processUsageDirect(String className, String usageType) {
                if (!isTargetApiType(className)) return;

                if (seenCalls.add(className + "." + usageType)) {
                    csvRows.add(new String[]{jarFileName, currentClass, className, usageType});
                }
            }
        };
    }

    private void checkTypeUsage(String rawType, String usageType) {
        if (rawType == null) return;
        String className = cleanType(rawType);
        if (!isTargetApiType(className)) return;

        if (seenCalls.add(className + usageType)) {
            csvRows.add(new String[]{jarFileName, currentClass, className + usageType, "CLASS_USAGE"});
        }
    }

    private boolean isTargetApiType(String className) {
        if (className == null || className.isEmpty()) return false;
        if (isPrimitiveOrPrimitiveArray(className)) return false;
        if (ExtractLibraryUsageFromJar.JDK_PREFIXES.stream().anyMatch(className::startsWith)) return false;

        // Fix: Changed from contains to startsWith
        return targetApiPackages.stream().anyMatch(className::startsWith);
    }

    private boolean isPrimitiveOrPrimitiveArray(String className) {
        Set<String> primitives = Set.of(
                "boolean", "byte", "char", "short", "int", "long", "float", "double",
                "boolean[]", "byte[]", "char[]", "short[]", "int[]", "long[]", "float[]", "double[]"
        );
        return primitives.contains(className);
    }

    private String cleanType(String rawOwner) {
        if (rawOwner == null) return "";
        while (rawOwner.startsWith("[")) rawOwner = rawOwner.substring(1);
        if (rawOwner.startsWith("L") && rawOwner.endsWith(";")) {
            rawOwner = rawOwner.substring(1, rawOwner.length() - 1);
        }
        return rawOwner.replace('/', '.');
    }
}