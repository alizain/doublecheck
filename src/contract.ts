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
- The project's full git history is available; \`git\` and \`rg\` are installed.
- Your current working directory is a writable scratch workspace.

---

${checkBody}

---

## Report

Write your findings as plain markdown to \`./${REPORT_FILE}\` in your working directory. Build it incrementally — start writing early and refine as you learn more; the final state of \`${REPORT_FILE}\` when you finish is the check's report.`
}
