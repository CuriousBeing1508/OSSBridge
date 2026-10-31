package org.example.lib;

public class ObjectNode extends Node {
    @Override
    public Node get(String name) { return this; }

    @Override
    public int size() { return 1; }
}
