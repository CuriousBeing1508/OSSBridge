#!/bin/bash

# Usage: ./ExtractDetailsFromJar.sh <path_to_jar_file>
# Example: ./ExtractDetailsFromJar.sh ../../data/dataset/LibraryJars/jackson-databind-2.17.2.jar

# Check if JAR file path is provided as argument
if [ -z "$1" ]; then
    echo "Error: No JAR file specified"
    echo "Usage: $0 <path_to_jar_file>"
    exit 1
fi

JAR_FILE="$1"

# Check if file exists
if [ ! -f "$JAR_FILE" ]; then
    echo "Error: JAR file not found: $JAR_FILE"
    exit 1
fi

# Get the directory where the JAR file is located
OUTPUT_DIR=$(dirname "$JAR_FILE")
JAR_NAME=$(basename "$JAR_FILE")

echo "Processing JAR: $JAR_NAME"
echo "Output directory: $OUTPUT_DIR"

# Initialize CSV output file with updated header
OUTPUT_CSV="$OUTPUT_DIR/${JAR_NAME%.jar}_available_apis.csv"
ERROR_LOG="$OUTPUT_DIR/error_log.txt"

# Clear the error log file if it exists
> "$ERROR_LOG"

# Initialize CSV file with headers (includes both FullSignature and SimpleSignature)
echo "Package,Class,Method,MethodDescriptor,FullSignature,SimpleSignature" > "$OUTPUT_CSV"

# Counter for progress
count=0

# List all .class files in the JAR and process each
jar tf "$JAR_FILE" 2>> "$ERROR_LOG" | grep '\.class$' | while read -r class; do
    # Get the fully qualified class name (package + class)
    qualified_class=$(echo "$class" | sed 's|/|.|g' | sed 's|\.class$||')
    
    # Extract package name
    package=$(echo "$qualified_class" | sed 's|\.[^.]*$||')
    # Extract class name
    class_name=$(echo "$qualified_class" | sed 's|.*\.||')
    
    # Use javap with -s flag to get method signatures/descriptors
    javap -public -s -classpath "$JAR_FILE" "$qualified_class" 2>> "$ERROR_LOG" | \
    while IFS= read -r line; do
        # Check if this is a method declaration line (starts with public and has parentheses)
        if echo "$line" | grep -qE '^[ ]+public.*\('; then
            method_line="$line"
            
            # Read the next line which contains the descriptor
            read -r descriptor_line
            
            # Extract method name (without return type and parameters)
            method_name=$(echo "$method_line" | sed 's/^.*public //' | sed 's/(.*//' | awk '{print $NF}')
            
            # Extract descriptor from "descriptor: ..." line
            if echo "$descriptor_line" | grep -q "descriptor:"; then
                descriptor=$(echo "$descriptor_line" | sed 's/.*descriptor: //' | tr -d ' ')
                
                # Build FullSignature WITH descriptor (unique identifier)
                full_signature="${qualified_class}.${method_name}${descriptor}"
                
                # Build SimpleSignature WITHOUT descriptor (for matching with dependents)
                simple_signature="${qualified_class}.${method_name}"
                
                # Escape quotes for CSV
                descriptor_escaped=$(echo "$descriptor" | sed 's/"/""/g')
                full_signature_escaped=$(echo "$full_signature" | sed 's/"/""/g')
                simple_signature_escaped=$(echo "$simple_signature" | sed 's/"/""/g')
                
                # Append to CSV: Package, Class, Method, MethodDescriptor, FullSignature, SimpleSignature
                echo "$package,$class_name,$method_name,\"$descriptor_escaped\",\"$full_signature_escaped\",\"$simple_signature_escaped\"" >> "$OUTPUT_CSV"
                
                count=$((count + 1))
                if [ $((count % 100)) -eq 0 ]; then
                    echo "Processed $count methods..."
                fi
            fi
        fi
    done
done

echo "Finished processing JAR: $JAR_NAME"
echo "Output file: $OUTPUT_CSV"
echo "Analysis complete!"