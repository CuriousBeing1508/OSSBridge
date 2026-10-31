package org.example.lib;

public class Codec extends Base implements Encoder {
    @Deprecated(forRemoval = true)
    public static String OLD_NAME = "old";

    public Codec() {}

    protected Codec(int level) {}

    public byte[] encode(byte[] input) { return input; }

    public static Codec create() { return new Codec(); }

    @Deprecated
    public byte[] legacyEncode(byte[] input) { return input; }

    void packagePrivate() {}

    private void secret() {}
}
