// The agent contract: what the harness stages for the agent and what the
// agent must leave behind. Any adapter (claude, codex) runs under this same
// contract, which is what keeps the harness CLI-agnostic. The one per-agent
// piece is `writeTool`: the phrase naming how THIS agent creates a file
// (claude has a literal Write tool; codex is just told to create the file —
// naming a tool it doesn't have would invite it to distrust its brief).

// Staged into the scratch workdir before boot; the rw bind mount delivers it.
export const PROMPT_FILE = "prompt.txt"
// The agent writes its findings here (relative to its cwd); the host reads it
// back after exit. Missing report = failure.
export const REPORT_FILE = "report.md"

// Weak models reliably skip a report contract stated once at the prompt's
// tail unless it leads with the stakes and orders the file created first
// (measured: haiku went from ~50% to 3/3 with this wording). Two hard-won
// additions (2026-07-05, all three cutover inspectors lost their reports):
// the path is ABSOLUTE — agents cd into the inspected tree to run git, and a
// relative ./report.md then lands in the read-only mount — and the
// create-first order is repeated near the top of the prompt (see
// firstActionLine), because on long prompts the tail alone loses its grip.
function reportContract(
	activity: string,
	deliverable: string,
	workdir: string,
	writeTool: string | null,
): string {
	const tool = writeTool ? ` ${writeTool}` : ""
	return `## Report — the only output that counts

Your final chat reply is discarded. The only thing read back is the file \`${workdir}/${REPORT_FILE}\` — if it does not exist when you exit, this run FAILS. Always use that absolute path: if you \`cd\` elsewhere (into the inspected tree, say), a relative \`./${REPORT_FILE}\` lands in the wrong place, or in a read-only mount where the write fails.

So: create \`${workdir}/${REPORT_FILE}\`${tool} BEFORE you start ${activity} (a title line is enough), and update it as you work. The final state of the file when you finish is ${deliverable}.`
}

function firstActionLine(workdir: string, writeTool: string | null): string {
	const tool = writeTool ? ` ${writeTool}` : ""
	return `Your FIRST action, before anything else: create \`${workdir}/${REPORT_FILE}\`${tool} (a title line is enough). The full report contract is at the end of this prompt.`
}

// Environment preamble + optional run context + check body + report
// contract. Checks are timeless standards; everything run-specific (intent,
// sanctioned exceptions, scope) arrives in the operator's run context — the
// harness knows nothing about git.
export function composePrompt(opts: {
	checkBody: string
	target: string
	workdir: string
	runContext: string | null
	writeTool: string | null
}): string {
	const contextSection = opts.runContext
		? `## Run context (from the operator)

The operator's brief for this run: the intent behind the work under review, known nuances, sanctioned exceptions, and possibly a Scope naming exactly what is under review. Judge requestedness against it — what the brief explicitly sanctions is not a finding. If it names a Scope, the Scope defines the change under review: findings must concern that change, and the rest of the tree is reference for judgment — with one exception. For concepts the scoped change retires or renames, surviving references anywhere in the tree are reportable findings: the Scope bounds what counts as the change, not where survivors may hide.

${opts.runContext}

---

`
		: ""
	return `## Environment

You are a code inspector running inside a sandboxed microVM with full permissions and unrestricted internet access.

- The code under inspection is mounted read-only at \`${opts.target}\`. You cannot modify it — inspect, don't fix.
- \`git\` and \`rg\` are installed.
- Your current working directory is a writable scratch workspace: \`${opts.workdir}\`.

${firstActionLine(opts.workdir, opts.writeTool)}

## Inspection discipline

Measured on real runs: inspectors that skip these rules produce reports whose verdicts are right but whose evidence is partly fabricated — which is worse than no report.

- Before inspecting, enumerate what is under review (the Run context's Scope list if one is given; otherwise your own enumeration of the target) and keep a ledger as you work: **examined** (content actually opened), **name-only**, **not examined**. End your report with that ledger, with a one-line reason for anything not examined.
- Use verification verbs — "verified", "confirmed", "checked", "read", "diffed", "grepped", "spot-checked" — ONLY for actions you actually performed in this session on content you actually opened. Everything else must be labeled as inference: "assumed identical by generation — not opened."
- Never truncate output you will base a claim on — no \`| head\` / \`| tail\` on a diff or search you intend to cite. Examine files one at a time instead.

---

${contextSection}${opts.checkBody}

---

${reportContract("inspecting", "the check's report", opts.workdir, opts.writeTool)}

Every single line of your report will be read in full by the operator's agent — nothing is skimmed, so every line costs attention. Verify each finding against the actual code before writing it down. A report that says "no findings" is a perfectly good report; an unverified finding is not.`
}

// The mining prompt: digest of one conversation + what counts as a durable
// preference observation + the block format the catalog accumulates.
export function composeMinePrompt(
	digest: string,
	workdir: string,
	writeTool: string | null,
): string {
	return `## Environment

You are running inside a sandboxed microVM with no network access. The machine's Claude Code transcripts are mounted read-only at their real paths; your current working directory is a writable scratch workspace: \`${workdir}\`.

${firstActionLine(workdir, writeTool)}

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

${reportContract("mining", "the mined observations", workdir, writeTool)}`
}
