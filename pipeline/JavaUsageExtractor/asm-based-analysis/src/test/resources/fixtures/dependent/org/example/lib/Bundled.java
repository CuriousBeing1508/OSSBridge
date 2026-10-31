package org.example.lib;

// A copy of library code bundled inside the dependent's jar
public class Bundled {
    public byte[] run() { return Codec.create().encode(null); }
}
