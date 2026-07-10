---
name: doublecheck
description: Use when the operator wants their code standards run against a tree or a branch's changes — you compose the run brief (--context), invoke doublecheck, read every report in full, and triage findings back to the operator.
---

# Driving doublecheck

You are the **driving agent**. doublecheck runs one sandboxed inspector per check against a read-only mount of the target; each inspector knows *only* what its check file and your run brief tell it. The four-layer division of labor:

- **Checks** (`.agents/checks/*.md`) — the operator's timeless standards. You don't edit these per run.
- **Run brief** (`--context` file) — everything about *this* run: intent, nuances, sanctioned exceptions, scope. **You write this. Its quality bounds the run's quality.**
- **You** — compile operator intent into the brief, invoke, read reports, triage.
- **Harness** — mechanics only. It knows nothing about git; scope reaches inspectors solely through your brief.

## Composing the brief — the load-bearing step

Write one markdown file (scratch location is fine). Shape:

```markdown
## Intent
What the work under review is trying to accomplish, in a few honest sentences:
the goal, the outcomes it drives toward, constraints that shaped it.

## Nuances and sanctioned exceptions
Anything the operator has explicitly accepted that a standard would otherwise
flag — one bullet each, with the reason. ("The compat shim in X is sanctioned
until the D9 migration lands.") The brief is the permission channel: an
exception not stated here WILL be reported as a finding.

## Scope
Review the changes below (<base>..<head> in <repo>); the rest of the tree is
reference, not review surface.

<paste the enumerated file list: `git diff --name-status <base>...HEAD`>
```

Rules that matter (each earned on a measured run):

- **Scope is data, not instructions.** Enumerate the changed files yourself (you have git); don't ask inspectors to derive the list. Keep the `M`/`A` status letters — residue checks legitimately fast-path added files. They may still use git inside the guest to see hunks for files on the list.
- **Sanctioned exceptions are mandatory, not optional color.** A run without them produced a rigorous, fully-false FAIL on an intentional cutover lag — the sanction list is the single thing an inspector cannot derive from the tree. Walk the design decisions and state every accepted deviation, with its reason.
- **Never point at files outside the mounted target.** A dead pointer (a design doc that isn't in the worktree) sent three inspectors on the same three-call dead hunt. Inline the relevant decisions into the brief instead.
- **Don't restate standards.** The checks own the judgment; the brief owns this run's reality. A brief that lectures about fallbacks dilutes both. (Likewise don't restate the harness's inspection discipline — ledger, attestation rules, sweep radius are already in every inspector's prompt.)
- **Be honest about intent.** The brief frames every verdict; describing aspiration as fact will suppress real findings.

## Invoking

```bash
CLAUDE_CODE_OAUTH_TOKEN=$(cat <token-file>) doublecheck check \
  --target <repo-under-inspection> \
  --checks-dir <shared-checks-dir> [--checks-dir <repo-checks-dir>] \
  --context <brief-file> \
  --check <name> ... \        # subset while iterating; omit for the full set
  --agent claude \            # or codex; picks which agent CLI inspects
  --model haiku \             # per-agent default: claude haiku, codex gpt-5.6-sol;
                              # haiku to iterate; raise for real gates
  --output <reports-root>     # default $TARGET/.doublecheck — point elsewhere
                              # if you shouldn't write into the target repo
```

- Source the token by command substitution as above — never print it, never echo it into a transcript. With `--agent codex` no token env var exists: the harness stages a copy of the host's `~/.codex/auth.json` and hard-fails if its tokens are stale (>7 days since refresh) — the fix is running any codex command on the host first.
- Same check name in two `--checks-dir`s is a hard error (rename, no precedence); a missing dir or empty union aborts loudly.
- From a clone of this repo without a global install: `pnpm doublecheck check …`.

## Reading reports

Reports land at `$OUTPUT/<run-timestamp>/<check>.md`, one per check; a failed agent leaves a `CHECK FAILED` report and flips the exit code.

- **Read every report in full.** The inspectors were told every line will be read — honor that; no skimming, no grepping for verdict lines (there are none by design).
- **Check the coverage ledger first.** Every report ends with an examined / name-only / not-examined ledger (harness-enforced). Gaps in it are honest and visible; a missing ledger is itself a signal the run went wrong.
- **Verify before relaying.** Every finding is a claim. Check it against the actual code, then hand the operator only what survived, ranked by severity, with file:line. With `--save-jsonl`, attestations are auditable too: any "verified X" whose file never appears in the stream's tool inputs is fabricated evidence.
- **Triage into three buckets:** real finding (operator acts) · false positive (a *check* needs a tighter "Do NOT flag" — propose the edit) · sanctioned-but-flagged (your *brief* missed an exception — fix the brief template you use).

## The loop

Every run teaches something: a false positive tightens a check, a miss adds a FAIL bullet to one, a noisy report tightens the brief. Checks accumulate judgment over time — that is the product. Mechanics live in the README; when the harness itself fights you, that's an issue on this repo, not a workaround in the brief.
