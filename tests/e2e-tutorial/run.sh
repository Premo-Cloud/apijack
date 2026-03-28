#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
docker build -f tests/e2e-tutorial/Dockerfile -t apijack-e2e .
docker run --rm apijack-e2e
