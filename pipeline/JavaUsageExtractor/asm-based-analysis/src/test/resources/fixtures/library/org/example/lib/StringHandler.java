package org.example.lib;

// Package-private implementation; javac adds a bridge handle(Object) -> handle(String)
class StringHandler implements Handler<String> {
    @Override
    public void handle(String value) {}
}
