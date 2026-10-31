package com.realise.asm_based_analysis;

import org.objectweb.asm.ClassReader;

import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import java.util.stream.Stream;

/**
 * Pipeline step 3: library usage in dependent jars.
 *
 * Usage:
 *   java -jar ossbridge-usage-analyzer.jar --library-jar LIB.jar
 *        (--dependents-dir DIR | --jar-list FILE) --usage-out usage.csv --summary-out summary.csv
 *
 * --dependents-dir analyzes every *.jar in DIR; --jar-list analyzes the jars listed in
 * FILE (one path per line), e.g. one batch of a larger download folder.
 *
 * usage.csv    one row per (dependent jar, category, target, declaring class):
 *              dependent_jar, category, target_class, target_member, target_descriptor,
 *              declaring_class, resolution, occurrences, caller_classes
 * summary.csv  one row per dependent jar:
 *              dependent_jar, status, classes, bundled_library_classes,
 *              bytecode_instructions, usage_rows, detail
 */
public final class AnalyzeUsage {

    static final String[] USAGE_COLUMNS = {"dependent_jar", "category", "target_class", "target_member",
            "target_descriptor", "declaring_class", "resolution", "occurrences", "caller_classes"};
    static final String[] SUMMARY_COLUMNS = {"dependent_jar", "status", "classes", "bundled_library_classes",
            "bytecode_instructions", "usage_rows", "detail"};

    record JarResult(String jar, String status, int classes, int bundledClasses, long instructions,
                     UsageCollector usages, String detail) {}

    public static void main(String[] args) throws IOException {
        Map<String, String> opts = parseArgs(args);
        boolean hasInput = opts.containsKey("--dependents-dir") != opts.containsKey("--jar-list");
        for (String required : List.of("--library-jar", "--usage-out", "--summary-out")) {
            if (!opts.containsKey(required) || !hasInput) {
                System.err.println("Usage: java -jar ossbridge-usage-analyzer.jar --library-jar LIB.jar "
                        + "(--dependents-dir DIR | --jar-list FILE) --usage-out usage.csv --summary-out summary.csv");
                System.exit(2);
            }
        }

        ClassIndex library = ClassIndex.ofJar(Paths.get(opts.get("--library-jar")));
        if (library.all().isEmpty()) {
            System.err.println("No classes found in library jar " + opts.get("--library-jar"));
            System.exit(1);
        }
        System.out.println("Library packages: " + library.packages().size()
                + ", classes: " + library.all().size());

        List<Path> jars;
        if (opts.containsKey("--jar-list")) {
            jars = Files.readAllLines(Paths.get(opts.get("--jar-list"))).stream()
                    .map(String::strip).filter(s -> !s.isEmpty()).map(Paths::get).toList();
        } else {
            try (Stream<Path> files = Files.list(Paths.get(opts.get("--dependents-dir")))) {
                jars = files.filter(p -> p.getFileName().toString().endsWith(".jar")).sorted().toList();
            }
        }

        Path usageOut = Paths.get(opts.get("--usage-out"));
        Path summaryOut = Paths.get(opts.get("--summary-out"));
        Path usageTmp = tmpPath(usageOut);
        Path summaryTmp = tmpPath(summaryOut);
        try (BufferedWriter usage = Files.newBufferedWriter(usageTmp);
             BufferedWriter summary = Files.newBufferedWriter(summaryTmp)) {
            writeRow(usage, USAGE_COLUMNS);
            writeRow(summary, SUMMARY_COLUMNS);
            int done = 0;
            for (Path jar : jars) {
                JarResult result = analyzeJar(jar, library);
                writeUsage(usage, result);
                writeRow(summary, new String[]{result.jar(), result.status(), String.valueOf(result.classes()),
                        String.valueOf(result.bundledClasses()), String.valueOf(result.instructions()),
                        String.valueOf(result.usages() == null ? 0 : result.usages().usages().size()),
                        result.detail()});
                done++;
                System.out.println("PROGRESS " + done + "/" + jars.size() + " " + result.jar() + " " + result.status());
            }
        }
        Files.move(usageTmp, usageOut, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        Files.move(summaryTmp, summaryOut, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    static JarResult analyzeJar(Path jar, ClassIndex library) {
        String name = jar.getFileName().toString();
        try {
            ClassIndex local = ClassIndex.ofJar(jar);
            UsageResolver resolver = new UsageResolver(library, local);
            UsageCollector collector = new UsageCollector();
            long[] instructions = {0};
            int classes = 0;
            int bundled = 0;
            int unreadable = 0;
            try (JarFile jarFile = new JarFile(jar.toFile())) {
                Enumeration<JarEntry> entries = jarFile.entries();
                while (entries.hasMoreElements()) {
                    JarEntry entry = entries.nextElement();
                    if (!ClassIndex.isAnalyzableClass(entry.getName())) continue;
                    try (InputStream in = jarFile.getInputStream(entry)) {
                        DependentClassVisitor visitor = new DependentClassVisitor(resolver, collector, instructions);
                        new ClassReader(in).accept(visitor, ClassReader.SKIP_DEBUG | ClassReader.SKIP_FRAMES);
                        classes++;
                        if (visitor.isBundledLibraryClass()) bundled++;
                    } catch (IllegalArgumentException | ArrayIndexOutOfBoundsException e) {
                        unreadable++;
                    }
                }
            }
            String detail = unreadable > 0 ? unreadable + " unreadable classes" : "";
            return new JarResult(name, "analyzed", classes, bundled, instructions[0], collector, detail);
        } catch (IOException | SecurityException e) {
            return new JarResult(name, "error", 0, 0, 0, null, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private static void writeUsage(BufferedWriter out, JarResult result) throws IOException {
        if (result.usages() == null) return;
        for (Map.Entry<UsageCollector.Key, UsageCollector.Stats> e : result.usages().usages().entrySet()) {
            UsageCollector.Key k = e.getKey();
            writeRow(out, new String[]{result.jar(), k.category(), k.targetClass(), k.member(), k.descriptor(),
                    k.declaringClass(), k.resolution(), String.valueOf(e.getValue().occurrences),
                    String.valueOf(e.getValue().callerClasses.size())});
        }
    }

    static void writeRow(BufferedWriter out, String[] values) throws IOException {
        List<String> cells = new ArrayList<>(values.length);
        for (String v : values) cells.add(csv(v));
        out.write(String.join(",", cells));
        out.newLine();
    }

    private static String csv(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n") || value.contains("\r")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }

    private static Path tmpPath(Path out) throws IOException {
        Path parent = out.toAbsolutePath().getParent();
        Files.createDirectories(parent);
        return parent.resolve(out.getFileName() + ".tmp");
    }

    private static Map<String, String> parseArgs(String[] args) {
        Map<String, String> opts = new HashMap<>();
        for (int i = 0; i + 1 < args.length; i += 2) opts.put(args[i], args[i + 1]);
        return opts;
    }
}
