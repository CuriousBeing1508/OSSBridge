# OSSBridge pipeline image: runs the whole pipeline for a library version.
#
#   docker build -t ossbridge-pipeline pipeline
#   docker run --rm -v "$PWD/data:/data" -v ossbridge-m2:/home/ossbridge/.m2 \
#       ossbridge-pipeline org.mybatis:mybatis:3.5.16
#
# /data holds runs/, results/, dependents-index/ (OSSBRIDGE_DATA); the optional
# ossbridge-m2 volume keeps Maven's downloads between runs. Library builds
# (step 5) run inside the container as a non-root user, with JDKs 8, 11, 17 and 21,
# Maven and Gradle.

# ---------------------------------------------------------------- analyzer jar
FROM maven:3.9.9-eclipse-temurin-21 AS analyzer
WORKDIR /src
COPY JavaUsageExtractor/asm-based-analysis/pom.xml .
RUN mvn -B -q dependency:go-offline
COPY JavaUsageExtractor/asm-based-analysis/src src
RUN mvn -B -q package

# ---------------------------------------------------------------- JDKs and build tools
FROM eclipse-temurin:8-jdk-jammy AS jdk8
FROM eclipse-temurin:11-jdk-jammy AS jdk11
FROM eclipse-temurin:17-jdk-jammy AS jdk17
FROM eclipse-temurin:21-jdk-jammy AS jdk21
FROM gradle:8.10.2-jdk21 AS gradle

# ---------------------------------------------------------------- pipeline
FROM python:3.12-slim-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends git unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=jdk8 /opt/java/openjdk /opt/jdk/8
COPY --from=jdk11 /opt/java/openjdk /opt/jdk/11
COPY --from=jdk17 /opt/java/openjdk /opt/jdk/17
COPY --from=jdk21 /opt/java/openjdk /opt/jdk/21
COPY --from=analyzer /usr/share/maven /opt/maven
COPY --from=gradle /opt/gradle /opt/gradle

ENV JAVA_HOME=/opt/jdk/21 \
    PATH=/opt/jdk/21/bin:/opt/maven/bin:/opt/gradle/bin:$PATH \
    OSSBRIDGE_JDKS=8=/opt/jdk/8,11=/opt/jdk/11,17=/opt/jdk/17,21=/opt/jdk/21 \
    OSSBRIDGE_DATA=/data \
    OSSBRIDGE_TOOLS=/opt/ossbridge/tools \
    OSSBRIDGE_USAGE_ANALYZER=/opt/ossbridge/ossbridge-usage-analyzer.jar \
    PYTHONUNBUFFERED=1

WORKDIR /opt/ossbridge/pipeline
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --from=analyzer /src/target/ossbridge-usage-analyzer.jar /opt/ossbridge/
COPY ossbridge_pipeline ossbridge_pipeline
COPY DependentsIndex DependentsIndex
COPY Results Results
COPY tests tests
COPY JavaUsageExtractor/asm-based-analysis/src/test/resources/fixtures \
     JavaUsageExtractor/asm-based-analysis/src/test/resources/fixtures

# JaCoCo jars for step 5, downloaded once at build time
RUN python -c "from ossbridge_pipeline.coverage import jacoco_tools; print(jacoco_tools())"

# Cache folders exist and belong to the user, so volumes mounted on them are writable
RUN useradd --create-home --uid 1000 ossbridge \
    && mkdir -p /data /home/ossbridge/.m2 /home/ossbridge/.gradle \
    && chown ossbridge /data /home/ossbridge/.m2 /home/ossbridge/.gradle
USER ossbridge
VOLUME /data

ENTRYPOINT ["python", "-m", "ossbridge_pipeline.run"]
CMD ["--help"]
