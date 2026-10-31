---
title: OSSBridge
sdk: docker
app_port: 7860
short_description: Java library API use by dependents vs. its test coverage
---

# OSSBridge

OSSBridge shows how the projects that depend on a Java library use its API, and
how well the library's own tests cover the parts they use.

The app reads the result tables published in the Hugging Face dataset
[rachna1508/ossbridge-results](https://huggingface.co/datasets/rachna1508/ossbridge-results).

This folder is the app (React frontend and Node.js backend):

- `Dockerfile` builds the Hugging Face Space: one container that serves the
  frontend and the API on port 7860 and reads the published result tables.
- `docker-compose.yml` runs the app locally as two containers; see
  [QWICKSTART.md](QWICKSTART.md).
