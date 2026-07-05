import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import PQueue from "p-queue"
import { claudeAgent, progressSink } from "./claude.ts"
import { composePrompt, PROMPT_FILE, REPORT_FILE } from "./contract.ts"
import { runAgent } from "./runner.ts"

// A check is a plain markdown file in $PROJECT/.agents/checks — no
// frontmatter, no schema. The body is the inspector's instructions; the name
// is the filename minus .md.
export interface Check {
	name: string
	body: string
}

// Pure selection: `only` (from repeated --check flags) filters, in the order
// named; naming a check that doesn't exist is an error, not an empty run.
export function selectChecks(all: Check[], only: string[], dir: string): Check[] {
	if (all.length === 0) throw new Error(`no checks (*.md) in ${dir}`)
	if (only.length === 0) return all
	const byName = new Map(all.map((c) => [c.name, c]))
	return only.map((name) => {
		const check = byName.get(name)
		if (!check) {
			const have = all.map((c) => c.name).join(", ")
			throw new Error(`no check named "${name}" in ${dir} (have: ${have})`)
		}
		return check
	})
}

// Shell: read every check file, then select purely.
export function discoverChecks(project: string, only: string[]): Check[] {
	const dir = join(project, ".agents", "checks")
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		throw new Error(`no checks directory at ${dir}`)
	}
	const all = entries
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => ({
			name: f.slice(0, -".md".length),
			body: readFileSync(join(dir, f), "utf-8"),
		}))
	return selectChecks(all, only, dir)
}

export interface CheckWorkflowOpts {
	project: string
	model: string
	parallel: number
	output: string
	only: string[]
}

// fs-safe local timestamp, one dir per run shared by all its checks:
// 2026-07-05-143000
export function runTimestamp(d: Date): string {
	const p = (n: number) => String(n).padStart(2, "0")
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

// The report written when the agent failed: the failure is the report, plus
// whatever partial report the agent managed to leave.
export function failureReport(reason: string, partialReport: string | null): string {
	const partial = partialReport
		? `\n---\n\nPartial ${REPORT_FILE} left by the agent:\n\n${partialReport}`
		: ""
	return `# CHECK FAILED\n\n${reason}\n${partial}`
}

async function runOneCheck(
	check: Check,
	opts: CheckWorkflowOpts,
	token: string,
	outDir: string,
): Promise<boolean> {
	const workdir = mkdtempSync(join(tmpdir(), `doublecheck-${check.name}-`))
	writeFileSync(join(workdir, PROMPT_FILE), composePrompt(check.body, opts.project))
	const spec = claudeAgent({ token, model: opts.model, workdir })
	const outcome = await runAgent({
		mount: opts.project,
		workdir,
		spec,
		network: "all",
		onLine: progressSink(check.name),
	})
	const reportPath = join(outDir, `${check.name}.md`)
	if (outcome.ok) {
		writeFileSync(reportPath, outcome.report)
		process.stderr.write(`[${check.name}] report: ${reportPath}\n`)
		return true
	}
	writeFileSync(reportPath, failureReport(outcome.reason, outcome.partialReport))
	process.stderr.write(`[${check.name}] FAILED (${outcome.reason}): ${reportPath}\n`)
	return false
}

// The check workflow: one sandboxed agent per check, at most `parallel`
// guests at once. Returns true only when every check produced a report; agent
// failures still write a failure-record report and flip the run to false.
export async function runChecks(opts: CheckWorkflowOpts): Promise<boolean> {
	const token = process.env.CLAUDE_CODE_OAUTH_TOKEN
	if (!token) {
		throw new Error(
			"CLAUDE_CODE_OAUTH_TOKEN is required in the environment (it is injected into each check's sandbox)",
		)
	}
	const checks = discoverChecks(opts.project, opts.only)
	const outDir = join(opts.output, runTimestamp(new Date()))
	mkdirSync(outDir, { recursive: true })
	process.stderr.write(
		`${checks.length} check(s) against ${opts.project} (model ${opts.model}, parallel ${opts.parallel})\n`,
	)
	const queue = new PQueue({ concurrency: opts.parallel })
	const results = await Promise.all(
		checks.map((check) => queue.add(() => runOneCheck(check, opts, token, outDir))),
	)
	return results.every((ok) => ok === true)
}
