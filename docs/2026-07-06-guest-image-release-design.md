# Guest image as a release artifact — design

**Date:** 2026-07-06
**Status:** approved (co-designed in conversation; this doc records the decisions)

## The problem

Through v2.1.0 the guest image existed only where someone had run
`scripts/build-guest-image.sh`: `runner.ts` pinned local-only
`doublecheck-guest:latest` with `pullPolicy("never")`. Every machine and
every image-affecting change (like baking in codex) demanded a manual
docker build + msb side-load — an install was not self-sufficient, and a
released CLI could silently run against an image missing the CLIs it
expected.

## The decision

The guest image is a versioned release artifact, published exactly like the
npm package and keyed to it:

- **Publish**: the `release` workflow, after semantic-release ships vX.Y.Z
  to npm, builds `Dockerfile.guest` for linux/amd64 + linux/arm64 and pushes
  `ghcr.io/alizain/doublecheck-guest:X.Y.Z` and `:latest`. The image job is
  gated on the release job, and skipped on dry runs or no-release runs.
- **Resolve**: `runner.ts` decides its image purely from its own package
  version (`decideGuestImage`): a released version boots
  `ghcr.io/alizain/doublecheck-guest:<version>` with
  `pullPolicy("if-missing")` — microsandbox pulls it on first use (the
  ContextLayer pattern, verified in their `boot-sandbox.ts`); the dev tree
  (`0.0.0-development`) keeps local `doublecheck-guest:latest` with `never`
  and the build script. `DOUBLECHECK_GUEST_IMAGE=<ref>` overrides either
  (operator-managed, never pulled).
- **CLI/image coupling**: tag = package version, so an installed CLI always
  boots the image built for it. Version skew between machines is impossible
  by construction; versioned tags make the msb cache correct forever.

## Mechanics that are easy to get wrong

- **The version is read at RUN time, not build time**: the workflow builds
  `dist/` *before* semantic-release stamps the real version into the
  published package.json, so baking the version into the bundle would pin
  every install to `0.0.0-development`. `runner.ts` reads
  `../package.json` relative to `import.meta.url` with `readFileSync` (not
  a static import), which resolves correctly from both `src/` (tsx) and
  `dist/` (bundle).
- **Detecting what semantic-release published**: it has no first-class
  output; the workflow snapshots the highest `v*` tag before the release
  step and re-reads it after (`git fetch --tags --force`). Changed → that
  version drives the image job; unchanged (dry run, nothing releasable) →
  image job skips.
- **The ghcr package must be public** for unauthenticated runtime pulls.
  Packages created by a GITHUB_TOKEN push start private — one-time
  visibility flip in the package settings after the first push.
- **`image_version` dispatch input** rebuilds + pushes the image for an
  already-released version, skipping the release. Recovery for a failed
  image job, and the new "rebuild to pick up newer agent CLIs" path (the
  CLIs install at image-build time). It mutates the tag in place; machines
  that already pulled keep their cached copy (`if-missing` never re-checks).
- **One QEMU job, not ContextLayer's native-runner digest-join**: their
  machinery (matrix build → push-by-digest → manifest join) exists for a
  graph of images needing native speed. doublecheck has one small image
  whose layers are apt + npm installs of prebuilt static binaries — QEMU
  cross-build suffices (validated locally: the amd64 image builds and both
  CLIs run under emulation). If the image ever grows compile steps, upgrade
  to their pattern.

## Non-changes

- `scripts/build-guest-image.sh` and the local-image dev flow stay as-is.
- The image contents, `GUEST_MEMORY_MIB`, mounts, and everything else about
  how guests run are untouched — this changes only where the image comes
  from.
