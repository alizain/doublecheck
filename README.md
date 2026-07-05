# doublecheck

Runs self-authored LLM code-inspectors ("checks") against a project — one
sandboxed agent per check, in parallel — and writes one markdown report per
check.

**A check is a markdown file:** `$PROJECT/.agents/checks/<name>.md`. No
frontmatter, no schema — the body is the inspector's instructions, and scoping
(whole tree, `git diff main`, one package) is the check's own prose; the
harness computes no diffs and knows nothing about git. **A report is a
markdown file:** whatever the agent writes, no imposed structure.

## Why this exists

Linters and type checkers catch what can be pattern-matched. The defects that
survive them are judgment calls: a silent fallback that swallows a config
error, an abstraction at the wrong layer, a "for now" that will outlive its
author. doublecheck encodes *your* judgment about those — each check is a
standard you actually hold, written as prose instructions to an inspector
agent that can read the whole tree and reason about it.

The division of labor is deliberate: everything that requires judgment lives
in the check body (what to flag, what to leave alone, where to look);
everything mechanical lives in the harness (sandboxing, parallelism, report
collection). The harness knows nothing about git, diffs, or languages, so it
never needs to change when your standards do.

## The loop

1. **`doublecheck mine`** distills your Claude Code history into durable
   preference observations (`~/.doublecheck/catalog`) — evidence of standards
   you have actually enforced in past conversations.
2. **A human and/or agent authors checks** from those observations. This step
   is deliberately unproductized: going from "observed preference" to
   "runnable standard" is judgment work.
3. **`doublecheck check`** runs every check against a project, one sandboxed
   agent per check, and writes one report per check. Read the reports, fix
   what is real, tighten any check that cried wolf.

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
npm install -g @alizain/doublecheck   # installs the `doublecheck` command; or, from a clone: pnpm install
```

Guests boot from a locally built image. Build it once from a clone of this
repo (needs a running Docker daemon; rebuild to pick up a newer claude CLI):

```bash
./scripts/build-guest-image.sh
```

## Usage

```bash
CLAUDE_CODE_OAUTH_TOKEN=... doublecheck check \
  --project DIR      # default: cwd
  --model MODEL      # default: haiku
  --parallel N       # default: 4 concurrent guests
  --output DIR       # default: $PROJECT/.doublecheck
  --check NAME       # repeatable; default: every check in .agents/checks/
```

The token is required and injected into each guest; where it comes from is
the operator's business.

### Mining your Claude history into an observation catalog

`doublecheck mine` walks every Claude Code transcript on the machine and runs
one sandboxed agent per real conversation (≥ `--min-turns` genuine human
turns) to extract durable engineering preferences into
`~/.doublecheck/catalog`, mirroring the transcript tree — one
`<project>/<session>/observations.md` per conversation, frontmatter recording
the source hash so re-runs only mine new or grown sessions. Mining guests get
egress to `*.anthropic.com` only. Design: `docs/2026-07-05-mine-design.md`.

```bash
CLAUDE_CODE_OAUTH_TOKEN=... doublecheck mine \
  --projects DIR     # default: ~/.claude/projects
  --catalog DIR      # default: ~/.doublecheck/catalog
  --model MODEL      # default: opus (a bad-model mine pollutes a durable asset)
  --parallel N       # default: 4
  --min-turns N      # default: 2
  --limit N          # mine at most N pending conversations
  --dry-run          # list what would be mined, boot nothing
```

`fixtures/planted/` is a tiny target with two planted silent fallbacks (and
two legitimate defaults that must not be flagged) for exercising the tool
end-to-end:

```bash
CLAUDE_CODE_OAUTH_TOKEN=... doublecheck check --project fixtures/planted --model haiku
```

## What the inspector sees

The facts of the agent's world, so you can decide how to author checks:

- **The agent** is one headless `claude -p` per check (model from `--model`,
  default haiku), running inside its own microVM with
  `--dangerously-skip-permissions` — no permission gates; the VM is the
  boundary. Its toolkit: Task (it can spawn subagents), Bash, Read, Write,
  Edit, Glob, Grep, WebSearch, WebFetch. Check agents have unrestricted
  internet egress.
- **Its only input is the prompt**: a short environment preamble (verbatim in
  `src/contract.ts`) + the check body + the report contract. No session, no
  conversation history, no other context — everything the inspector knows
  about your standards is what the check body says.
- **The filesystem**: the project is bind-mounted read-only at its real host
  path — the live working tree, dirty files and `.git` included, so `git
  log`/`git diff`/`git blame` and `rg` work against the real repo; writes to
  it fail. The guest image also has node 24, curl, and wget. The cwd is a
  writable scratch dir private to the check; nothing in it survives except
  `report.md`.
- **The output**: the prompt tells the agent its chat reply is discarded and
  only `./report.md` is read back. The harness imposes no structure on the
  report — it contains whatever the check body asks for.

```bash
pnpm doublecheck # run the CLI from source (tsx)
pnpm test        # vitest — pure logic, plus real-guest integration tests with a FAKE agent (never real claude)
pnpm typecheck   # tsc --noEmit
pnpm check       # biome
```

Design record: `docs/2026-07-05-doublecheck-design.md`.

## Releasing

Manual, via the `release` GitHub Actions workflow — semantic-release over
Conventional Commits, ported from pggit. Nothing releases as a side effect of
pushing to main.

```bash
gh workflow run release -f dry_run=true    # preview next version + notes, publish nothing
gh workflow run release -f dry_run=false   # ship: npm publish + GitHub Release + tag
```

- **Only `feat:` / `fix:` / `BREAKING CHANGE:` commits trigger a release** and
  decide the bump (minor / patch / major). Other commit styles ride along
  unreleased — use `docs:`/`chore:`/plain messages for work that shouldn't ship
  a version.
- `version` in package.json stays `0.0.0-development` forever — semantic-release
  derives the real version from git tags. Never hand-bump it.
- The pre-publish gate is biome + tsc + **unit tests only** (`test:unit`
  excludes `*.integration.test.ts`, which boots real microsandbox guests CI
  doesn't have) + tsdown build. Run the full `pnpm test` locally before
  releasing.
- Needs the `NPM_TOKEN` repo secret: a token that can publish
  `@alizain/doublecheck` without an OTP prompt — classic "Automation" type, or
  a granular token with read/write package access (and 2FA bypass if the
  account requires 2FA for writes).

Learned the hard way on the first release (2026-07-05):

- **A failed `npm publish` leaves a stale tag.** semantic-release pushes
  `vX.Y.Z` *before* publishing to npm. If the publish step fails, delete the
  tag (`git push origin :refs/tags/vX.Y.Z`) before retrying — otherwise the
  retry sees the tag as the last release, finds no new conventional commits,
  and releases nothing.
- **The package is scoped because npm forbids unscoped `doublecheck`.** The
  name-similarity rule (`DoubleCheck` and `double-check` exist) rejects it with
  a 403 at publish time only — registry lookups 404 as if the name were free.
  The installed bin is still `doublecheck`; `publishConfig.access: public` is
  what keeps a scoped package from defaulting to private.
- **npm provenance/OIDC is off on purpose** — the presence of `id-token: write`
  makes npm 11.x prefer trusted publishing and 404 when none is configured
  (npm/cli#8976). Details in the comment block of
  `.github/workflows/release.yml`.
