# This code uses the Extract-library-usage-from-bytecode.jar to extract the usage of a library from the dependents 
# jars downloaded in folder DepJarDataset.

import os
import subprocess

def run_static_analysis(
    jar_path: str,
    output_dir: str,
    target_dependency: str,
    java_jar_path: str 
):
    """
    Run the Java static analysis tool for the specified JAR directory.

    :param jar_path: Path to the directory containing .jar files of dependents.
    :param output_dir: Directory to save the analysis results.
    :param target_dependency: Maven coordinate of the target dependency, e.g., com.fasterxml.jackson.core:jackson-databind
    :param java_jar_path: Path to the Java .jar tool that performs the analysis.
    """
    cmd = [
        "java", "-jar", java_jar_path,
        jar_path,
        output_dir,
        target_dependency
    ]

    print(f"Running: {' '.join(cmd)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        print("Analysis completed successfully.")
        print("Output:\n", result.stdout)
        if result.stderr:
            print("Warnings/Errors:\n", result.stderr)
    except subprocess.CalledProcessError as e:
        print(f"Error occurred while running analysis:\n{e.stderr}")
        raise

# Example usage
if __name__ == "__main__":
    # Change these paths as needed
    # Note: always use coordinated format of target dependency for example target_dependency = "org.apache.commons:commons-codec", so the jar will derive: {"org.apache.commons", "org.apache.commons.codec"}
    dep_jar_dir = "Dataset/DepJarDataset/commons-codec-1.17.1"
    output_dir = "Dataset/StaticAnaResults/commons-codec-1.17.1"
    target_dependency = "org.apache.commons:commons-codec"
    analysis_jar = "Extract-library-usage-from-bytecode.jar"

    run_static_analysis(dep_jar_dir, output_dir, target_dependency, analysis_jar)
