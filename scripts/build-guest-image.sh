#!/usr/bin/env bash
# Build the guest image and side-load it into the microsandbox cache.
# Requires a running Docker daemon (OrbStack/Docker Desktop). No registry:
# `msb load` imports the docker-save tarball directly.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="doublecheck-guest:latest"

docker build -f Dockerfile.guest -t "$IMAGE" .
docker save "$IMAGE" | pnpm exec msb load --tag "$IMAGE"
pnpm exec msb image list
