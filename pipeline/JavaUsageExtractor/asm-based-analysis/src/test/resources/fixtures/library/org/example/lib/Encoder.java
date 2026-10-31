package org.example.lib;

public interface Encoder {
    byte[] encode(byte[] input);

    default String label() { return "encoder"; }
}
