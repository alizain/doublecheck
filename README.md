# doublecheck

Runs self-authored LLM code-inspectors ("checks") against a project — one
sandboxed agent per check, in parallel — and writes one markdown report per
check.

**A check is a markdown file:** `$PROJECT/.agents/checks/<name>.md`. No
frontmatter, no schema — the body is the inspector's instructions, and scoping
(whole tree, `git diff main`, one package) is the check's own prose; the
harness computes no diffs and knows nothing about git. **A report is a
markdown file:** whatever the agent writes, no imposed structure.

## How it works

Per check: a scratch workdir gets `prompt.txt` (environment preamble + check
body + report contract). A [microsandbox](https://github.com/superradcompany/microsandbox)
microVM boots from a locally built image with the project bind-mounted
**read-only at its real host path** and the scratch dir mounted rw as the
guest cwd. `claude -p` runs inside with the full inspector toolkit (Task,
Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch) and no permission
gates — the microVM is the safety boundary, the ro mount is the "don't touch
my repo" guarantee. The agent writes `report.md`; the host copies it to
`$OUTPUT/<run-timestamp>/<check>.md`.

The project is never copied — every guest shares the live host directory
(dirty files included) through the ro mount, so per-check cost is one temp dir
and ~2 GiB of guest memory.

Exit 0 only when every check produced a report. An agent failure (exit ≠ 0,
no report) writes a failure-record report and flips the run's exit code;
missing token / checks / image abort loudly up front.

## Setup

```bash
pnpm install
./scripts/build-guest-image.sh   # needs a running Docker daemon; rebuild to pick up a newer claude CLI
```

## Usage

```bash
CLAUDE_CODE_OAUTH_TOKEN=... pnpm doublecheck run \
  --project DIR      # default: cwd
  --model MODEL      # default: haiku
  --parallel N       # default: 4 concurrent guests
  --output DIR       # default: $PROJECT/.doublecheck
  --check NAME       # repeatable; default: every check in .agents/checks/
```

The token is required and injected into each guest; where it comes from is
the operator's business.

`fixtures/planted/` is a tiny target with two planted silent fallbacks (and
two legitimate defaults that must not be flagged) for exercising the tool
end-to-end:

```bash
CLAUDE_CODE_OAUTH_TOKEN=... pnpm doublecheck run --project fixtures/planted --model haiku
```

## Development

```bash
pnpm test        # vitest — pure logic, plus real-guest integration tests with a FAKE agent (never real claude)
pnpm typecheck   # tsc --noEmit
pnpm check       # biome
```

Design record: `docs/2026-07-05-doublecheck-design.md`.
