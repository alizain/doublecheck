// The agent contract: what the harness stages for the agent and what the
// agent must leave behind. Any adapter (claude today, codex someday) runs
// under this same contract, which is what keeps the harness CLI-agnostic.

// Staged into the scratch workdir before boot; the rw bind mount delivers it.
export const PROMPT_FILE = "prompt.txt"
// The agent writes its findings here (relative to its cwd); the host reads it
// back after exit. Missing report = failure.
export const REPORT_FILE = "report.md"

// Weak models reliably skip a report contract stated once at the prompt's
// tail unless it leads with the stakes and orders the file created first
// (measured: haiku went from ~50% to 3/3 with this wording).
function reportContract(activity: string, deliverable: string): string {
	return `## Report — the only output that counts

Your final chat reply is discarded. The only thing read back is the file \`./${REPORT_FILE}\` in your working directory — if it does not exist when you exit, this run FAILS.

So: create \`./${REPORT_FILE}\` with the Write tool BEFORE you start ${activity} (a title line is enough), and update it as you work. The final state of the file when you finish is ${deliverable}.`
}

// Environment preamble + check body + report contract. Scoping (diff vs tree)
// is the check's own prose — the harness knows nothing about git.
export function composePrompt(checkBody: string, project: string): string {
	return `## Environment

You are a code inspector running inside a sandboxed microVM with full permissions and unrestricted internet access.

- The project under inspection is mounted read-only at \`${project}\`. You cannot modify it — inspect, don't fix.
- \`git\` and \`rg\` are installed.
- Your current working directory is a writable scratch workspace.

---

${checkBody}

---

${reportContract("inspecting", "the check's report")}`
}

// The mining prompt: digest of one conversation + what counts as a durable
// preference observation + the block format the catalog accumulates.
export function composeMinePrompt(digest: string): string {
	return `## Environment

You are running inside a sandboxed microVM with no network access. The machine's Claude Code transcripts are mounted read-only at their real paths; your current working directory is a writable scratch workspace.

## Task

You are mining ONE Claude Code conversation for the operator's durable preferences — how they want engineering done, in any conversation, not what they wanted built in this one.

Below is the conversation digest: every genuine human turn, numbered, in order. When a turn is a terse correction or interruption ("no", "stop", "don't", "why did you…", "[Request interrupted]"), recover its context: the "# source:" header names the full session transcript — Grep that turn's text in it to find its line, then Read the assistant turns IMMEDIATELY BEFORE it with offset/limit. The preference lives in the contrast between what the assistant did and what the operator demanded. NEVER read a transcript whole — some are tens of MB.

---

${digest}

---

## What counts as an observation (strict)

A durable preference, backed by a verbatim quote from the digest or transcript:

- **kind: code** — how code should be written/structured/shaped ("no silent fallbacks", "reuse the existing helper instead of hand-rolling").
- **kind: workflow** — how work should proceed ("verify before claiming done", "ask before making scope decisions").
- **kind: style** — how prose/output/docs should read.

Exclude task-of-the-moment directives with no durable signal ("add a tab to home.tsx", "kill the dev server"). Exclude anything you cannot quote. Be conservative: a weak or speculative observation is worse than none.

## Observation format

The report is observation blocks and NOTHING else — no title, no preamble, no summary or conclusion sections. One block per observation:

## <kebab-case-name>
- **observation:** <one sentence: the durable preference>
- **kind:** code | workflow | style
- **evidence:** "<verbatim quote>" — turn <N>

For **code** observations that an LLM reviewer could check against a diff or file tree (a concrete change could flip PASS↔FAIL), and ONLY for those — never on workflow or style blocks — ALSO add:

- **pass/fail:** PASS when <…>; FAIL when <…>
- **why-LLM:** <why a deterministic linter cannot enforce this>
- **scope:** diff-only | needs-tree

If the conversation carries no durable preference signal, the report is exactly these two lines and nothing more:

No durable preference signal.
<one sentence: what the conversation was about instead>

${reportContract("mining", "the mined observations")}`
}
