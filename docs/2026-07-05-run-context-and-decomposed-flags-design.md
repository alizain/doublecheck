# Run context + decomposed flags — design

**Date:** 2026-07-05
**Status:** approved (co-designed in conversation; this doc records the decisions)

## The problem

v1's `--project` fused four jobs: check-discovery root, the ro-mounted
inspection tree, the path named in the prompt, and the default output anchor.
That fusion encoded "the repo being checked owns the standards it's checked
against" — which breaks in a folder-of-many-repos setup where one universal
check set serves every repo and each repo adds its own. And v1 gave the
inspector no channel for run-specific reality (what the work under review is
*trying* to do), which half of any serious check set needs: "unrequested
fallback" and "did the task need this now?" are unjudgeable without intent.

## The four-layer model

| Layer | Owns |
|---|---|
| **Checks** | The standard — timeless judgment, free of operational notes |
| **Run context** | This run's reality: intent, outcomes, nuances, sanctioned exceptions, scope-as-data |
| **Driving agent** | Compiling operator intent into the context file; invoking; reading reports in full |
| **Harness** | Mechanics only: sandbox, mount, parallelism, report collection — git-free forever |

Scope is a **run** concept, not a check or harness concept: the same standard
runs diff-scoped today and tree-scoped next month. It rides in the context
file **as data** (an enumerated changed-file list the driving agent produced
with git), not as instructions the inspector must execute correctly — weak
models follow data shapes far more reliably than imperative asides.

## Decisions

- `--project` → `--target`: the flag now means only "the tree under
  inspection" (mount + prompt path). Name follows the narrowed concept.
- `--checks-dir <dir>`, repeatable. Default: `$TARGET/.agents/checks` —
  the convention survives as a *default*, not a discovery rule. Explicit
  flags **replace** the default (same semantics as `--output`); no implicit
  unioning. Same check name in two dirs = hard error (no precedence rules);
  empty union = hard error; missing dir = hard error.
- `--context <file>`: exactly one file, spliced verbatim into every
  inspector's prompt as `## Run context (from the operator)` between the
  environment preamble and the check body, with a harness framing line:
  judge requestedness against it; what it sanctions is not a finding; if it
  names a Scope, findings must come from that scope.
- **No verdict structure in reports.** The calling agent reads every report
  in full. Instead the report contract tells the inspector: every line will
  be read, verify each finding against the actual code first, and a report
  that says "no findings" is a perfectly good report.
- The repo's own `no-silent-fallbacks` check is deleted — superseded by the
  operator's canonical check set (`fail-loud` et al.), which lives outside
  this repo. `fixtures/planted/.agents/checks/` keeps its copy: that one is
  test scaffolding for exercising the harness, not a standard.
- `SKILL.md` (how a driving agent should use doublecheck — above all, what a
  good `--context` brief contains) lives in this repo. It is load-bearing:
  the tool's output quality is bounded by the brief's quality.

## Non-changes

- The harness stays git-free. If scope-as-context-data ever proves
  unreliable in practice, the evidence-driven upgrade is a brief-generating
  helper, not git awareness in the runner.
- `mine` is untouched.

## Amendment (same day): inspection discipline + sweep radius — experiment-validated

Six audited runs (three baseline sonnet inspections, then three controlled
experiments, each transcript-audited via `--save-jsonl` by an independent
agent) established two systematic defects and validated their fixes before
they were baked in:

- **Confabulated attestation is a model-level register**, present in five of
  six runs regardless of context: reports used verification verbs
  ("confirmed by X", "grepped, no hits") for actions the transcripts prove
  never happened. Verdicts survived on generated-code symmetry — luck, not
  process. A context-delivered discipline block (ledger + attestation rules)
  drove unbacked claims from 3 to **0** and widened coverage to 85/85, so
  the wording moved into the harness prompt as **## Inspection discipline**:
  enumerate-then-ledger (examined / name-only / not examined), verification
  verbs licensed only by performed actions, inference explicitly labeled,
  and no truncation of cited output (stated as the concrete behavior —
  examine files one at a time — because the polite form was breached three
  times in its own validation run). This is the first structure the harness
  imposes on report content; it is earned, and `--save-jsonl` makes a
  fabricated ledger one grep away from exposure.
- **"Findings must come from that scope" over-constrained residue checks**:
  it suppressed a true tree-level survivor of a retired concept. The
  framing line now carries the tested radius clause: the Scope defines the
  change; survivors of concepts the change retired are reportable anywhere.
- **Placement rule** (operator-decided): learnings land in the harness
  prompt — never copied into every check, never left to each brief. Only
  brief-composition lessons (sanction lists are mandatory; no pointers
  outside the mount; keep M/A flags) live in SKILL.md, because they govern
  the driving agent, not the inspector.
