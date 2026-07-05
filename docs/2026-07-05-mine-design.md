# doublecheck mine — design

**Date:** 2026-07-05
**Status:** approved (co-designed in conversation; this doc records the decisions)

## What it is

A second subcommand: `doublecheck mine` walks every Claude Code transcript on
the machine and runs one sandboxed agent per real conversation to extract
**durable preference observations** — how the operator wants engineering done —
into a personal, append-only catalog. The catalog feeds the deliberately
*unproductized* middle: humans and agents collaboratively shape observations
into checks (or memory files, or docs, or nothing). `mine` is a workflow and
`run` is a workflow; everything between them stays messy on purpose.

Broad by design: the June 2026 gate-mining run kept only gate-shaped
candidates and discarded process/workflow/style signal as `rejected`. `mine`
keeps anything durably general, tagged by kind — the gate-shape analysis
survives as *enrichment* on code observations, not as the admission filter.

## Command

```
doublecheck mine [--projects DIR=~/.claude/projects] [--catalog DIR=~/.doublecheck/catalog]
                 [--model M=opus] [--parallel N=4] [--min-turns N=2]
                 [--limit N] [--dry-run]
```

- `--model` defaults to **opus** — deliberately opposite of `run`'s haiku. A
  bad-model mine pollutes a durable asset; cheap test-drives say
  `--model haiku --limit 3` explicitly.
- `--dry-run` lists each unit's status (new / changed / mined / below-threshold)
  without booting anything — the calibration tool.
- `--limit N` mines only the first N pending units.
- `--min-turns` is the ≥2-genuine-human-turns content filter (measured June
  2026: it collapses ~7,700 sessions to ~240 real conversations with no
  project blocklist).

## Data model — the catalog mirrors the corpus

Each transcript `$PROJECTS/<project>/<session>.jsonl` maps to a folder
`$CATALOG/<project>/<session>/` holding `observations.md`:

```markdown
---
source: /Users/…/.claude/projects/<project>/<session>.jsonl
source_sha256: <hash of the jsonl at mine time>
mined_at: 2026-07-05T16:45:00-04:00
model: opus
human_turns: 14
---

## <kebab-case-name>
- **observation:** <one sentence: the durable preference>
- **kind:** code | workflow | style
- **evidence:** "<verbatim quote>" — <project>::<session>::turn <N>
```

- **The host writes the frontmatter** (it knows hash, model, time); the agent
  writes only observation blocks. The final file is host-composed:
  frontmatter + agent report.
- Code-inspectable observations additionally carry the June enrichment fields
  — `pass/fail`, `why-LLM`, `scope: diff-only | needs-tree` — which are what
  make later check-authoring possible.
- The durability bar replaces the gate-shape bar: task-of-the-moment
  directives stay out; anything evidently general gets in. Only observations
  backed by a verbatim quote are admitted.
- A no-signal conversation writes an observations.md whose body is a one-line
  self-skip note — mined-and-empty is a recorded fact, not a gap.
- The folder (rather than a bare file) is deliberate room for future
  per-conversation artifacts.

**Incrementality is self-describing:** a unit is skipped when its
`observations.md` exists and `source_sha256` matches the current jsonl hash.
Hash-compare is the fast path — already-mined sessions are never parsed. A
changed (resumed/grown) session re-mines and overwrites its own folder. No
manifest files.

**Failure semantics differ from `run` deliberately:** a failed mine writes
*nothing* to the catalog (next run retries), logs loud, and exits non-zero.
Failure records don't belong in a durable append-only asset.

## Mechanics — a second consumer of the v1 runner

- **Digest extraction** (TS port of the June jq filter, pure + unit-tested):
  genuine human turns only — `type:user`, not meta/sidechain, text content,
  command-wrapper/system-reminder/caveat lines excluded — newline-flattened,
  2,000-char per-turn cap. Computed in memory and embedded inline in
  `prompt.txt`; no digest files on disk.
- **Prompt:** adapted June mining prompt (broadened admission, same
  grep-the-source instruction: for terse corrections/interruptions, grep the
  source jsonl and read the assistant turns just before — never read a
  transcript whole) + the same hardened report contract as `run`
  ("report.md is the only output that counts").
- **Sandbox per unit:** transcripts dir mounted **read-only** (the miner
  greps sources), scratch rw as cwd, claude adapter unchanged. **Network
  disabled** (`disableNetwork()`): the whole personal corpus is mounted and
  mining needs no internet — that combination must not exist. The runner
  grows one option (`network: "all" | "none"`); `run` keeps allowAll.
- p-queue caps concurrent guests, exactly as `run`.

## Prior catalog

The June catalog (`~/ContextLayer/internal/scratch/2026-06-12-code-gates-catalog/`)
is **ignored entirely** — another agent is actively consuming it for check
creation. The new catalog starts empty at `~/.doublecheck/catalog`, so the
first full run is the broad re-mine of all history at the wider aperture.

## Testing

No real claude, ever (standing rule). Digest extraction, unit enumeration,
hash/skip decisions: pure vitest units over synthetic jsonl fixtures.
Integration: real guests with a fake miner (bash writing observation blocks)
against a synthetic transcripts tree — asserts mirror layout, host-composed
frontmatter, skip-on-rerun, re-mine-on-change, nothing-written-on-failure.
Live calibration happens ad-hoc via `--limit` + `--dry-run`.

## Out of scope (recorded, not built)

Synthesis/INDEX tooling, check-authoring tooling (the messy middle stays
human↔agent collaborative), Phase-1-style repo mining, catalog
post-processing, any structured verdicts.
