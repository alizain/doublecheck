# doublecheck — design

**Date:** 2026-07-05
**Status:** approved (co-designed in conversation; this doc records the decisions)

## What it is

A standalone CLI that runs self-authored LLM code-inspectors ("checks") against a project, one sandboxed agent per check, in parallel, and writes one markdown report per check. A generic tool with no ContextLayer coupling — ContextLayer is merely its first user.

Why it exists: an automated second pair of eyes that enforces the owner's engineering judgment (fail-loud, no duplicate paths, layering, …) on any repo, on command, so code gets written faster. Cases accumulate over time; the harness is the product.

## Operating model — extreme simplicity

- **A check is a markdown file.** `$PROJECT/.agents/checks/<name>.md`. No frontmatter, no schema, no scope field. The body is the inspector's instructions. Check name = filename minus `.md`.
- **A report is a markdown file.** Whatever the agent writes. No JSON, no verdict schema, no imposed structure. Structure gets added *when* a real need appears, not before.
- **Scoping lives in the check, not the tool.** The harness computes no diffs and knows nothing about git. A check that wants diff-scope says "run `git diff main`" in its own prose; the guest has the repo and git.

## Architecture

Three seams:

1. **CLI** (`commander`): `doublecheck run [--project DIR] [--model MODEL] [--parallel N] [--output DIR] [--check NAME]...`
   - `--project` defaults to cwd; `--model` defaults to `haiku` (cheap iteration; raise for real runs); `--parallel` defaults to 4; `--output` defaults to `$PROJECT/.doublecheck`.
   - `--check` (repeatable) filters to a subset; default is every file in `.agents/checks/`.
   - Reports land at `${OUTPUT}/${RUN_START_TS}/${CHECK_NAME}.md`, one fs-safe timestamp dir per run (e.g. `2026-07-05-143000`), shared by all checks in the run.
2. **Adapter** — the agent-runner interface. Contract: given a booted guest, a scratch cwd, and a composed prompt, run an agent that **writes `report.md` into its cwd**. The claude adapter execs `claude -p --dangerously-skip-permissions --output-format stream-json < prompt.txt` inside the guest (fetch-context's proven invocation). Report-as-file keeps the contract CLI-agnostic — a future codex adapter execs `codex exec` under the same contract.
3. **Sandbox runner** (microsandbox `^0.6.2`) — per check:
   - `mkdtemp` a scratch workdir; write `prompt.txt` (environment preamble + check body + footer naming the repo path and the `report.md` contract).
   - Boot a guest from the local image: project dir bind-mounted **read-only at its real host path** (`MountBuilder.bind(project).readonly()`), scratch workdir bind-mounted rw as cwd (host==guest identical paths).
   - Env: `CLAUDE_CODE_OAUTH_TOKEN` (passthrough), `ANTHROPIC_MODEL`, `IS_SANDBOX=1`, `GIT_OPTIONAL_LOCKS=0`, `HOME=/root`.
   - Network: `NetworkPolicy.allowAll()` — checks may use the internet.
   - Stream agent progress to stderr; on exit read `workdir/report.md` → write `${OUTPUT}/${TS}/${CHECK}.md`; `stop()` + `remove()` the guest.

## The file model (why it scales to 10–15 parallel guests)

The project is never copied. Every guest shares the same live host directory through a read-only bind mount — dirty/unstaged files included, because it *is* the directory. Per-guest cost is one temp dir holding two small files. The read-only flag is the "don't run amok on my laptop" guarantee at the mount level; the microVM is the blast radius for everything else (agents run with full tools and zero permission gates). Memory is the real concurrency budget: ~2 GiB/guest.

## Platforms

macOS (Apple Hypervisor) and Linux (KVM) — microsandbox's support matrix, and a hard requirement. Nothing in the tool is platform-specific: auth is env-token-only (no macOS keychain reads — this is one reason why), paths come from `node:os`/`node:path`, and the guest image is built locally on either OS.

## Guest image

Purpose-built `Dockerfile.guest`: `node:24-bookworm-slim` + `git`, `ripgrep`, `curl`, `wget` + `@anthropic-ai/claude-code` baked in (pins the CLI version, saves ~30s/boot). Built locally by `scripts/build-guest-image.sh`, side-loaded into the microsandbox cache, `pullPolicy: "never"` — a cache miss means "run the build script". Never pushed to a registry.

## Auth

The CLI reads `CLAUDE_CODE_OAUTH_TOKEN` from its own environment and injects it into guests. **Required; the CLI fails loudly at startup if absent.** Where the token comes from is the operator's business — nothing about any account, token file, or wrapper script is encoded in the tool. A minimal guest `~/.claude.json` (only the trust-accepted entry for the workdir) is staged via textPatch so headless claude skips the trust prompt.

## Failure semantics

Fail loud, no fallbacks: missing token → abort; missing image → abort with "run scripts/build-guest-image.sh"; empty checks dir → abort; agent exit ≠ 0 or no `report.md` → that check's report records the failure and the run's exit code is non-zero. Exit 0 only when every check produced a report.

(Report content is unstructured by design, so v1 has no machine "pass/fail" — exit codes reflect *harness* success. Gate semantics arrive when reports grow structure, if they ever need to.)

## Project conventions

`~/Experiments/doublecheck`, boilerplate from `~/Experiments/fetch-context`: pnpm, `type: module`, `tsx` bin entry, commander, biome, vitest, TypeScript strict. GH repo via `gh repo create` when ready.

## v1 scope

- One check to prove the structure: `no-silent-fallbacks` (adapted from the mined catalog — `internal/scratch/2026-06-12-code-gates-catalog/INDEX.md` in the ContextLayer workspace is the parts bin for future checks).
- Fixture: a small planted-fallback diff in a test repo (or doublecheck itself) that the check must flag.
- Out of scope for v1: structured verdicts, CI wiring, non-claude adapters (the seam exists; nothing implements it), report post-processing.

## Future (recorded, not built)

More checks imported from the catalog; a codex/gemini adapter behind the same report-contract; structured verdict extraction *when* aggregation needs it; CI invocation.
