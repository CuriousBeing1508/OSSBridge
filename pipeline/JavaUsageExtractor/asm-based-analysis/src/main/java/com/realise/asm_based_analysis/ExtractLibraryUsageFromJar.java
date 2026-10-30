package com.realise.asm_based_analysis;

import org.objectweb.asm.ClassReader;

import java.io.*;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.jar.JarFile;

public class ExtractLibraryUsageFromJar {

    private static Path BASE_OUTPUT_DIR;
    private static final List<String[]> analysisSummary = new ArrayList<>();
    public static final Set<String> JDK_PREFIXES = Set.of(
            "java.", "javax.", "jdk.", "sun.", "com.sun.",
            "org.w3c.", "org.xml.", "org.omg."
    );

    private static PrintWriter logWriter;
    private static Set<String> targetApiPackages;

    public static void main(String[] args) throws IOException {
        if (args.length < 3) {
            System.err.println("Usage: java ThirdPartyCallBatchAnalyzer <input-jar-dir> <output-dir> <target-dependency-id>");
            System.err.println("Example: java ... ./jars ./output com.fasterxml.jackson.core:jackson-databind");
            return;
        }

        Path jarDir = Paths.get(args[0]);
        BASE_OUTPUT_DIR = Paths.get(args[1]);
        String targetDependency = args[2];

        Files.createDirectories(BASE_OUTPUT_DIR);
        // ✅ Create Dependents subdirectory
        Files.createDirectories(BASE_OUTPUT_DIR.resolve("Dependents"));

        logWriter = new PrintWriter(Files.newBufferedWriter(BASE_OUTPUT_DIR.resolve("analysis_log.txt")));
        log("Analysis started at " + LocalDateTime.now());
        log("Target Dependency: " + targetDependency);

        targetApiPackages = extractApiPackagesFromDependency(targetDependency);
        log("Extracted API packages: " + targetApiPackages);

        try (DirectoryStream<Path> stream = Files.newDirectoryStream(jarDir, "*.jar")) {
            for (Path jarPath : stream) {
                log("\nAnalyzing: " + jarPath.getFileName());
                analyzeJar(jarPath);
            }
        }

        writeSummaryCsv(BASE_OUTPUT_DIR.resolve("analysis_summary.csv").toString());
        log("Analysis completed at " + LocalDateTime.now());
        logWriter.close();
    }

    private static void analyzeJar(Path jarPath) {
        try (JarFile jarFile = new JarFile(jarPath.toFile())) {
            // ✅ Output CSV goes to Dependents/ subdirectory
            String outputCsv = BASE_OUTPUT_DIR
                    .resolve("Dependents")
                    .resolve(jarPath.getFileName().toString().replace(".jar", "_third_party_calls.csv"))
                    .toString();

            Set<String> seenCalls = new TreeSet<>();
            List<String[]> csvRows = new ArrayList<>();
            final int[] totalInstructions = {0};
            String jarFileName = jarPath.getFileName().toString();

            jarFile.stream()
                    .filter(e -> e.getName().endsWith(".class"))
                    .forEach(entry -> {
                        try (InputStream is = jarFile.getInputStream(entry)) {
                            ClassReader reader = new ClassReader(is);
                            reader.accept(
                                    new ThirdPartyClassVisitor("", seenCalls, csvRows, totalInstructions, jarFileName, targetApiPackages),
                                    ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES
                            );
                        } catch (IllegalArgumentException iae) {
                            log(" Skipped class due to unsupported version: " + entry.getName() + " -> " + iae.getMessage());
                        } catch (IOException e) {
                            log(" Failed to read class: " + entry.getName() + " -> " + e.getMessage());
                        }
                    });

            log("Total bytecode instructions: " + totalInstructions[0]);
            log("Unique API usages: " + seenCalls.size());

            // Only write CSV and add to summary if there are actual usages
            if (seenCalls.size() > 0) {
                writeCsv(outputCsv, csvRows);
                log("✓ Exported to: " + outputCsv);

                analysisSummary.add(new String[]{
                        jarFileName, "-", String.valueOf(totalInstructions[0]), String.valueOf(seenCalls.size())
                });
            } else {
                log("⊘ No API usages found - skipping CSV export");
            }

        } catch (IOException e) {
            log("✗ Failed to process JAR: " + jarPath.getFileName() + " -> " + e.getMessage());
        }
    }

    private static Set<String> extractApiPackagesFromDependency(String coordinate) {
        Set<String> packages = new HashSet<>();

        String[] parts = coordinate.split(":");
        if (parts.length != 2) {
            log(" Invalid dependency coordinate format: " + coordinate);
            return packages;
        }

        String groupId = parts[0];      // org.apache.commons
        String artifactId = parts[1];   // commons-codec

        // Always add the groupId as base
        packages.add(groupId);

        // Convert artifactId to package format (dash to dot)
        String artifactAsPackage = artifactId.replace("-", ".");

        // Get the last part of groupId
        String lastGroupIdPart = groupId.substring(groupId.lastIndexOf('.') + 1);

        // Check if artifact starts with the last part of groupId
        if (artifactAsPackage.startsWith(lastGroupIdPart + ".")) {
            // Remove redundant prefix: "commons.codec" -> "codec"
            artifactAsPackage = artifactAsPackage.substring(lastGroupIdPart.length() + 1);
        }

        // Add the derived full package
        packages.add(groupId + "." + artifactAsPackage);

        log(" Derived API packages from dependency: " + packages);
        return packages;
    }

    static void writeCsv(String fileName, List<String[]> rows) {
        try {
            Path outputPath = Paths.get(fileName);
            Files.createDirectories(outputPath.getParent());
            try (BufferedWriter writer = Files.newBufferedWriter(outputPath)) {
                writer.write("JarFile,CallerClass,Usage,Category");
                writer.newLine();
                for (String[] row : rows) {
                    writer.write(String.join(",", row));
                    writer.newLine();
                }
            }
        } catch (IOException e) {
            log("Failed to write CSV: " + e.getMessage());
        }
    }

    private static void writeSummaryCsv(String fileName) {
        try {
            Path outputPath = Paths.get(fileName);
            try (BufferedWriter writer = Files.newBufferedWriter(outputPath)) {
                writer.write("JarFile,BasePackage,TotalInstructions,UniqueThirdPartyUsages");
                writer.newLine();
                for (String[] row : analysisSummary) {
                    writer.write(String.join(",", row));
                    writer.newLine();
                }
            }
            log("Summary exported to: " + fileName);
        } catch (IOException e) {
            log("Failed to write summary CSV: " + e.getMessage());
        }
    }

    private static void log(String message) {
        System.out.println(message);
        logWriter.println(message);
        logWriter.flush();
    }
}