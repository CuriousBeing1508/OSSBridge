package com.realise.asm_based_analysis;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Counts the library usages of one dependent jar. */
final class UsageCollector {

    /** One usage target; class names are dotted (a.b.C). */
    record Key(String category, String targetClass, String member, String descriptor,
               String declaringClass, String resolution) {}

    static final class Stats {
        long occurrences;
        final Set<String> callerClasses = new HashSet<>();
    }

    private final Map<Key, Stats> usages = new LinkedHashMap<>();

    void add(Key key, String callerClass) {
        Stats stats = usages.computeIfAbsent(key, k -> new Stats());
        stats.occurrences++;
        stats.callerClasses.add(callerClass);
    }

    Map<Key, Stats> usages() {
        return usages;
    }
}
