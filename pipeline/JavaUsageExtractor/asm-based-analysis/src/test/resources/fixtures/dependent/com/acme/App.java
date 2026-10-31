package com.acme;

import org.example.lib.Codec;
import org.example.lib.Marker;
import org.example.lib.Mode;
import org.example.lib.internal.Util;

import java.util.function.Function;

@Marker
public class App extends Codec {
    private final Codec codec = Codec.create();

    public App() { super(1); }

    public void run() {
        codec.encode(new byte[0]);
        codec.encode(null);
        codec.hello("x");            // declared in Base
        codec.label();               // default method of Encoder
        hello("y");                  // through this subclass
        hook();                      // protected, through this subclass
        Mode.A.ordinal();            // declared in java.lang.Enum
        Function<byte[], byte[]> f = codec::encode;
        String d = Codec.DEFAULT;    // field declared in Base
        Object o = codec;
        boolean b = o instanceof Codec;
        Class<?> k = Codec.class;
        Util.twice(2);
        encode(null);                // overridden below: the dependent's own method
        toString();                  // java.lang.Object
    }

    @Override
    public byte[] encode(byte[] input) { return input; }

    @Marker
    public void annotated(@Marker String p) {}
}
