package com.acme;

import org.example.lib.Codec;
import org.example.lib.Encoder;
import org.example.lib.Mode;

public class Other implements Encoder {
    Mode mode;

    public byte[] encode(byte[] input) { return new Codec().encode(input); }
}
