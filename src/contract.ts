// The agent contract: what the harness stages for the agent and what the
// agent must leave behind. Any adapter (claude today, codex someday) runs
// under this same contract, which is what keeps the harness CLI-agnostic.

// Staged into the scratch workdir before boot; the rw bind mount delivers it.
export const PROMPT_FILE = "prompt.txt"
// The agent writes its findings here (relative to its cwd); the host reads it
// back after exit. Missing report = check failure.
export const REPORT_FILE = "report.md"

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

## Report — the only output that counts

Your final chat reply is discarded. The only thing read back is the file \`./${REPORT_FILE}\` in your working directory — if it does not exist when you exit, this check run FAILS.

So: create \`./${REPORT_FILE}\` with the Write tool BEFORE you start inspecting (a title line is enough), and update it as you work. The final state of the file when you finish is the check's report.`
}
