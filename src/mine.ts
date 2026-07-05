import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import PQueue from "p-queue"
import {
	composeObservationsFile,
	enumerateUnits,
	observationsPath,
	type Unit,
	type UnitStatus,
	unitStatus,
} from "./catalog.ts"
import { claudeAgent, describeStreamLine } from "./claude.ts"
import { composeMinePrompt, PROMPT_FILE } from "./contract.ts"
import { runAgent } from "./runner.ts"

export interface MineOpts {
	projects: string
	catalog: string
	model: string
	parallel: number
	minTurns: number
	limit?: number
	dryRun: boolean
}

interface Pending {
	unit: Unit
	status: Extract<UnitStatus, { kind: "pending" }>
}

async function mineOneUnit(
	{ unit, status }: Pending,
	opts: MineOpts,
	token: string,
): Promise<boolean> {
	const tag = unit.session.slice(0, 8)
	const workdir = mkdtempSync(join(tmpdir(), `doublecheck-mine-${tag}-`))
	writeFileSync(join(workdir, PROMPT_FILE), composeMinePrompt(status.digest))
	const spec = claudeAgent({ token, model: opts.model, workdir })
	process.stderr.write(
		`[${tag}] mining ${unit.project}/${unit.session} (${status.turns} turns, ${status.reason})\n`,
	)
	const outcome = await runAgent({
		mount: opts.projects,
		workdir,
		spec,
		network: "anthropic-only",
		onLine: (kind, line) => {
			if (kind === "stderr") {
				process.stderr.write(`[${tag}] ! ${line}\n`)
				return
			}
			const described = describeStreamLine(line)
			if (described) process.stderr.write(`[${tag}] ${described}\n`)
		},
	})
	// A failed mine writes NOTHING — the catalog is a durable asset; the next
	// run retries this unit because no hash gets recorded.
	if (!outcome.ok) {
		process.stderr.write(`[${tag}] FAILED (${outcome.reason})\n`)
		return false
	}
	const obsPath = observationsPath(opts.catalog, unit)
	mkdirSync(dirname(obsPath), { recursive: true })
	writeFileSync(
		obsPath,
		composeObservationsFile(
			{
				source: unit.jsonlPath,
				sourceSha256: status.sourceSha256,
				minedAt: new Date().toISOString(),
				model: opts.model,
				humanTurns: status.turns,
			},
			outcome.report,
		),
	)
	process.stderr.write(`[${tag}] observations: ${obsPath}\n`)
	return true
}

// The mine workflow: enumerate the corpus, decide per-unit status (hash
// fast-path), then one sandboxed agent per pending conversation. Returns true
// when nothing it attempted failed.
export async function runMine(opts: MineOpts): Promise<boolean> {
	const units = enumerateUnits(opts.projects)
	const statuses = units.map((unit) => ({
		unit,
		status: unitStatus(unit, opts.catalog, opts.minTurns),
	}))
	const count = (kind: UnitStatus["kind"]) =>
		statuses.filter((s) => s.status.kind === kind).length
	const unreadable = statuses.filter((s) => s.status.kind === "unreadable")
	for (const { unit, status } of unreadable) {
		if (status.kind === "unreadable")
			process.stderr.write(
				`UNREADABLE ${unit.project}/${unit.session}: ${status.error}\n`,
			)
	}
	const pending = statuses.filter((s): s is Pending => s.status.kind === "pending")
	const todo = opts.limit ? pending.slice(0, opts.limit) : pending
	process.stderr.write(
		`${units.length} transcripts: ${pending.length} pending` +
			(todo.length !== pending.length ? ` (mining ${todo.length})` : "") +
			`, ${count("mined")} mined, ${count("below-threshold")} below ${opts.minTurns} turns, ${unreadable.length} unreadable\n`,
	)

	if (opts.dryRun) {
		for (const { unit, status } of todo) {
			console.log(
				`${status.reason.padEnd(7)} ${status.turns.toString().padStart(4)} turns  ${unit.project}/${unit.session}`,
			)
		}
		return true
	}
	if (todo.length === 0) return true

	const token = process.env.CLAUDE_CODE_OAUTH_TOKEN
	if (!token) {
		throw new Error(
			"CLAUDE_CODE_OAUTH_TOKEN is required in the environment (it is injected into each miner's sandbox)",
		)
	}
	const queue = new PQueue({ concurrency: opts.parallel })
	const results = await Promise.all(
		todo.map((p) => queue.add(() => mineOneUnit(p, opts, token))),
	)
	const failed = results.filter((ok) => ok !== true).length
	process.stderr.write(
		`mined ${results.length - failed}/${results.length}${failed ? `, ${failed} FAILED` : ""}\n`,
	)
	return failed === 0
}
