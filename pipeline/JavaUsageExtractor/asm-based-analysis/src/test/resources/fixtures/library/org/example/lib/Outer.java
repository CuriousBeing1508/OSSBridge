package org.example.lib;

public class Outer {
    public static class Nested {
        public void nested() {}
    }

    protected static class ProtectedNested {
        public void protectedNested() {}
    }

    private static class PrivateNested {
        public void privateNested() {}
    }

    public Runnable task() {
        return new Runnable() {
            public void run() {}
        };
    }
}
