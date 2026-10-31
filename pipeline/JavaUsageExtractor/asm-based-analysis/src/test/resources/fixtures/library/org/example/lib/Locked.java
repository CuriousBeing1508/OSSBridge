package org.example.lib;

// Final: its protected members cannot be used by dependents
public final class Locked {
    public void open() {}

    protected void notReachable() {}
}
