#!/bin/bash
# To execute this script, use this commands:
# chmod +x ExtractCoverageCommons-codec.sh
# ./ExtractCoverageCommons-codec.sh commons-codec 1.17.1 apache commons-codec


LIBRARY=$1
VERSION=$2
GITHUB_OWNER=$3
GITHUB_REPO=$4

if [ -z "$LIBRARY" ] || [ -z "$VERSION" ] || [ -z "$GITHUB_OWNER" ] || [ -z "$GITHUB_REPO" ]; then
    echo "Usage: $0 <library> <version> <github-owner> <github-repo>"
    exit 1
fi

echo "=========================================="
echo "Extracting test coverage for $LIBRARY-$VERSION"
echo "=========================================="

WORK_DIR="./temp_coverage/${LIBRARY}-${VERSION}"
TAG="${LIBRARY}-${VERSION}"
EXTRACTED_DIR_NAME="${GITHUB_REPO}-${TAG}"
ZIP_FILE="$WORK_DIR/source.zip"

# Check if already downloaded and extracted
if [ -d "$WORK_DIR/$EXTRACTED_DIR_NAME" ] || [ -d "$WORK_DIR/${TAG}" ] || [ -d "$WORK_DIR/${GITHUB_REPO}-rel-${TAG}" ]; then
    echo "✓ Source code already downloaded and extracted"
    echo "  Skipping download and extraction..."
    
    cd "$WORK_DIR"
    
    # Find the correct extracted directory
    if [ -d "$EXTRACTED_DIR_NAME" ]; then
        EXTRACTED_DIR="$EXTRACTED_DIR_NAME"
    elif [ -d "${TAG}" ]; then
        EXTRACTED_DIR="${TAG}"
    else
        EXTRACTED_DIR="${GITHUB_REPO}-rel-${TAG}"
    fi
    
# Check if zip exists but not extracted yet
elif [ -f "$ZIP_FILE" ]; then
    echo "✓ Source zip already downloaded"
    echo "  Extracting..."
    
    cd "$WORK_DIR"
    unzip -q source.zip
    
    EXTRACTED_DIR="${GITHUB_REPO}-${TAG}"
    [ ! -d "$EXTRACTED_DIR" ] && EXTRACTED_DIR="${TAG}"
    [ ! -d "$EXTRACTED_DIR" ] && EXTRACTED_DIR="${GITHUB_REPO}-rel-${TAG}"
    
    if [ ! -d "$EXTRACTED_DIR" ]; then
        echo "Error: Could not find extracted directory"
        ls -la
        cd ../../
        rm -rf "$WORK_DIR"
        exit 1
    fi
    
    rm source.zip
    echo "✓ Extraction complete"
    
else
    # Download and extract (nothing exists yet)
    echo "Downloading and extracting source code..."
    mkdir -p "$WORK_DIR"
    cd "$WORK_DIR"

    DOWNLOAD_URL="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/archive/refs/tags/rel/${TAG}.zip"

    echo "Downloading from: $DOWNLOAD_URL"
    curl -L -o source.zip "$DOWNLOAD_URL"

    if [ $? -ne 0 ]; then
        echo "Error: Failed to download"
        cd ../../
        rm -rf "$WORK_DIR"
        exit 1
    fi

    echo "Extracting..."
    unzip -q source.zip

    EXTRACTED_DIR="${GITHUB_REPO}-${TAG}"
    [ ! -d "$EXTRACTED_DIR" ] && EXTRACTED_DIR="${TAG}"
    [ ! -d "$EXTRACTED_DIR" ] && EXTRACTED_DIR="${GITHUB_REPO}-rel-${TAG}"

    if [ ! -d "$EXTRACTED_DIR" ]; then
        echo "Error: Could not find extracted directory"
        echo "Available directories:"
        ls -la
        cd ../../
        rm -rf "$WORK_DIR"
        exit 1
    fi
    
    rm source.zip
    echo "✓ Download and extraction complete"
fi

cd "$EXTRACTED_DIR"
echo "Working in: $(pwd)"

if [ -f "pom.xml" ]; then
    echo "Detected Maven project"
    
    # ALWAYS restore from backup if it exists to ensure clean state
    if [ -f "pom.xml.original" ]; then
        echo "Restoring pom.xml from backup for clean start..."
        cp pom.xml.original pom.xml
        echo "✓ Restored from backup"
    else
        # First time - create backup
        cp pom.xml pom.xml.original
        echo "✓ Created backup: pom.xml.original"
    fi
    
    # Fix Java version compatibility FIRST (before adding plugins)
    echo "Fixing Java version compatibility..."
    if grep -q "<javac.src.version>1.7</javac.src.version>" pom.xml; then
        echo "Updating Java version from 7 to 8..."
        
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' 's|<javac\.src\.version>1\.7</javac\.src\.version>|<javac.src.version>1.8</javac.src.version>|g' pom.xml
            sed -i '' 's|<javac\.target\.version>1\.7</javac\.target\.version>|<javac.target.version>1.8</javac.target.version>|g' pom.xml
        else
            sed -i 's|<javac\.src\.version>1\.7</javac\.src\.version>|<javac.src.version>1.8</javac.src.version>|g' pom.xml
            sed -i 's|<javac\.target\.version>1\.7</javac\.target\.version>|<javac.target.version>1.8</javac.target.version>|g' pom.xml
        fi
        
        echo "✓ Updated Java version settings"
        echo "Verifying changes:"
        grep "javac.src.version\|javac.target.version" pom.xml
    else
        echo "✓ Java version is compatible"
    fi
    
    # Add JaCoCo plugin if not present
    if ! grep -q "jacoco-maven-plugin" pom.xml; then
        echo "Adding JaCoCo plugin..."
        
        cat > jacoco-config.xml << 'JACOCO_EOF'
            <plugin>
                <groupId>org.jacoco</groupId>
                <artifactId>jacoco-maven-plugin</artifactId>
                <version>0.8.11</version>
                <executions>
                    <execution>
                        <id>default-prepare-agent</id>
                        <goals>
                            <goal>prepare-agent</goal>
                        </goals>
                    </execution>
                    <execution>
                        <id>default-report</id>
                        <phase>test</phase>
                        <goals>
                            <goal>report</goal>
                        </goals>
                    </execution>
                </executions>
            </plugin>
JACOCO_EOF
        
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/<\/plugins>/i\
'"$(cat jacoco-config.xml)"'' pom.xml
        else
            sed -i '/<\/plugins>/i\'"$(cat jacoco-config.xml)" pom.xml
        fi
        
        rm jacoco-config.xml
        echo "✓ JaCoCo plugin added"
    else
        echo "✓ JaCoCo already configured"
    fi
    
    # Check for hardcoded <argLine> in surefire plugin and fix it
    if grep -q "<argLine>" pom.xml; then
        echo "Found hardcoded <argLine> in pom.xml"
        
        # Check if @{argLine} is already present
        if ! grep -q "@{argLine}" pom.xml; then
            echo "Fixing argLine to allow JaCoCo agent injection..."
            
            # Add @{argLine} to all <argLine> tags
            if [[ "$OSTYPE" == "darwin"* ]]; then
                sed -i '' 's|<argLine>|<argLine>@{argLine} |g' pom.xml
            else
                sed -i 's|<argLine>|<argLine>@{argLine} |g' pom.xml
            fi
            
            echo "✓ Fixed argLine configurations:"
            grep "<argLine>" pom.xml | head -5
        else
            echo "✓ argLine already has @{argLine}"
        fi
    fi
    
    # Add surefire plugin with testFailureIgnore if not present
    if ! grep -q "maven-surefire-plugin" pom.xml; then
        echo "Adding Surefire plugin..."
        cat > surefire-config.xml << 'SUREFIRE_EOF'
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-surefire-plugin</artifactId>
                <version>3.0.0-M9</version>
                <configuration>
                    <testFailureIgnore>true</testFailureIgnore>
                    <argLine>@{argLine}</argLine>
                </configuration>
            </plugin>
SUREFIRE_EOF
        
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' '/<\/plugins>/i\
'"$(cat surefire-config.xml)"'' pom.xml
        else
            sed -i '/<\/plugins>/i\'"$(cat surefire-config.xml)" pom.xml
        fi
        
        rm surefire-config.xml
        echo "✓ Surefire plugin added"
    fi
    
    echo ""
    echo "Running tests with coverage (this may take 5-20 minutes)..."
    echo "=================================================="
    
    # Run tests with coverage, disabling java14+ profile
    mvn clean test jacoco:report \
    -Dmaven.test.failure.ignore=true \
    -Dmaven.test.error.ignore=true \
    -Drat.skip=true \
    -P!java14+ \
    2>&1 | tee maven-output.log
    
    COVERAGE_XML="target/site/jacoco/jacoco.xml"
    COVERAGE_HTML="target/site/jacoco/index.html"
    
    # Fallback: if report wasn't generated but jacoco.exec exists
    if [ ! -f "$COVERAGE_XML" ] && [ -f "target/jacoco.exec" ]; then
        echo "Found execution data, generating report..."
        mvn jacoco:report
    fi
    
elif [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
    echo "Detected Gradle project"
    
    if ! grep -q "jacoco" build.gradle*; then
        echo "Adding JaCoCo to build.gradle..."
        cat >> build.gradle << 'GRADLE_EOF'

apply plugin: 'jacoco'

jacoco {
    toolVersion = "0.8.11"
}

test {
    finalizedBy jacocoTestReport
    ignoreFailures = true
}

jacocoTestReport {
    dependsOn test
    reports {
        xml.required = true
        html.required = true
    }
}
GRADLE_EOF
        echo "✓ JaCoCo added to build.gradle"
    else
        echo "✓ JaCoCo already configured"
    fi
    
    if [ -f "gradlew" ]; then
        chmod +x ./gradlew
        GRADLE_CMD="./gradlew"
    else
        GRADLE_CMD="gradle"
    fi
    
    echo "Running tests with Gradle..."
    $GRADLE_CMD clean test jacocoTestReport --continue
    
    COVERAGE_XML="build/reports/jacoco/test/jacocoTestReport.xml"
    COVERAGE_HTML="build/reports/jacoco/test/html/index.html"
    
else
    echo "Error: No build file found"
    cd ../../../
    exit 1
fi

# Verify coverage files exist
echo ""
echo "Checking for coverage files..."

if [ ! -f "$COVERAGE_XML" ]; then
    echo ""
    echo " ERROR: Coverage was not generated"
    echo ""
    echo "Debugging information:"
    echo "  Looking for: $COVERAGE_XML"
    echo "  Current directory: $(pwd)"
    echo ""
    
    if [ -f "target/jacoco.exec" ]; then
        echo "   jacoco.exec found: target/jacoco.exec"
        ls -lh target/jacoco.exec
    else
        echo "   jacoco.exec NOT found - JaCoCo agent didn't attach"
    fi
    
    if [ -d "target/surefire-reports" ]; then
        TEST_COUNT=$(find target/surefire-reports -name "*.xml" | wc -l)
        echo "   Test results found: $TEST_COUNT test files"
    else
        echo "   No test results found"
    fi
    
    echo ""
    echo "Maven output saved to: maven-output.log"
    echo "Directory preserved for debugging: $(pwd)"
    echo ""
    
    cd ../../../
    exit 1
fi

# Success! Copy files
OUTPUT_DIR="../../data/dataset/TestCoverage"
mkdir -p "$OUTPUT_DIR"

echo "✓ Coverage XML found: $COVERAGE_XML"
if [ -f "$COVERAGE_HTML" ]; then
    echo "✓ Coverage HTML found: $COVERAGE_HTML"
fi

echo ""
echo "Copying coverage reports..."
cp "$COVERAGE_XML" "$OUTPUT_DIR/${LIBRARY}-${VERSION}_coverage.xml"

if [ -f "$COVERAGE_HTML" ]; then
    mkdir -p "$OUTPUT_DIR/${LIBRARY}-${VERSION}_html"
    cp -r "$(dirname $COVERAGE_HTML)"/* "$OUTPUT_DIR/${LIBRARY}-${VERSION}_html/"
fi

echo ""
echo " SUCCESS! Coverage extracted!"
echo ""
echo "Files saved to:"
echo "  XML: $OUTPUT_DIR/${LIBRARY}-${VERSION}_coverage.xml"
if [ -d "$OUTPUT_DIR/${LIBRARY}-${VERSION}_html" ]; then
    echo "  HTML: $OUTPUT_DIR/${LIBRARY}-${VERSION}_html/index.html"
fi

# Display coverage summary
if command -v xmllint &> /dev/null; then
    echo ""
    echo "Coverage Summary:"
    
    XML_PATH="$OUTPUT_DIR/${LIBRARY}-${VERSION}_coverage.xml"
    
    INSTRUCTION_COVERED=$(xmllint --xpath "sum(//counter[@type='INSTRUCTION']/@covered)" "$XML_PATH" 2>/dev/null || echo "0")
    INSTRUCTION_MISSED=$(xmllint --xpath "sum(//counter[@type='INSTRUCTION']/@missed)" "$XML_PATH" 2>/dev/null || echo "0")
    
    if [ "$INSTRUCTION_COVERED" != "0" ] || [ "$INSTRUCTION_MISSED" != "0" ]; then
        TOTAL=$((INSTRUCTION_COVERED + INSTRUCTION_MISSED))
        PERCENTAGE=$(echo "scale=2; $INSTRUCTION_COVERED * 100 / $TOTAL" | bc 2>/dev/null || echo "N/A")
        
        echo "  Instructions Covered: $INSTRUCTION_COVERED"
        echo "  Instructions Missed: $INSTRUCTION_MISSED"
        echo "  Total Instructions: $TOTAL"
        echo "  Coverage: $PERCENTAGE%"
    fi
fi

# Cleanup prompt
echo ""
read -p "Keep temporary source directory for future runs? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    cd ../../../
    rm -rf "$WORK_DIR"
    echo "✓ Cleaned up temporary files"
else
    cd ../../../
    echo "✓ Source directory preserved at: $WORK_DIR"
fi

echo ""
echo " Done!"