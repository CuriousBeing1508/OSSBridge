---
title: OSSBridge
sdk: docker
app_port: 7860
short_description: Java library API use by dependents vs. its test coverage
---

# OSSBridge

OSSBridge shows how the projects that depend on a Java library use its API, and
how well the library's own tests cover the parts they use.

## How to use it

1. Search for a Java library, for example `mybatis` or `commons-codec`.
2. Pick a version. Green versions are analyzed and show their results.
3. The Maintainer Summary shows which parts of the API the dependent projects use,
   how many projects use them, and whether the library's tests cover them.

For a version that is not analyzed yet, press **Analyze**. The analysis runs on
GitHub Actions and takes 10 to 15 minutes on average. The version turns green when
its results are ready. At most 3 analyses run at once, and at most 5 can start per hour.

## Good to know

- The list of dependent projects comes from a snapshot of Maven Central taken on
  20 April 2025. Versions released after that date are not listed.
- Each analysis tries every dependent project of the version and keeps the ones that
  actually call the library. The version list shows how long each analysis took.
- Test coverage is measured by building the library from its GitHub source and running
  its tests. This is not always possible, for example when the library does not link to
  a GitHub repository. The page then says why, and the usage results are still shown.

## Data and code

The results are published in the Hugging Face dataset
[rachna1508/ossbridge-results](https://huggingface.co/datasets/rachna1508/ossbridge-results).

The code, and how to run the app on your own computer, are at
https://github.com/CuriousBeing1508/OSSBridge. Please report problems at
https://github.com/CuriousBeing1508/OSSBridge/issues.
