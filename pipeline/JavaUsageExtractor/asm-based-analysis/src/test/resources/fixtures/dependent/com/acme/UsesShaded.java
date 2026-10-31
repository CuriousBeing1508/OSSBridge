package com.acme;

public class UsesShaded {
    public byte[] run() { return new com.acme.shaded.org.example.lib.Codec().encode(null); }
}
