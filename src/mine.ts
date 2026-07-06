import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import PQueue from "p-queue"
import { type AgentRun, progressSink, resolveAgentRun } from "./agent-cli.ts"
import {
	composeObservationsFile,
	enumerateUnits,
	observationsPath,
	type Unit,
	type UnitStatus,
	unitStatus,
} from "./catalog.ts"
import { composeMinePrompt, PROMPT_FILE } from "./contract.ts"
import { runAgent } from "./runner.ts"

export interface MineOpts {
	projects: string
	catalog: string
	agent: string
	// Absent = the agent CLI's default for mining.
	model?: string
	parallel: number
	minTurns: number
	limit?: number
	dryRun: boolean
}

export interface Pending {
	unit: Unit
	status: Extract<UnitStatus, { kind: "pending" }>
}

// What one mine invocation will and won't do, decided purely from the
// per-unit statuses.
export interface MinePlan {
	todo: Pending[]
	pendingTotal: number
	mined: number
	belowThreshold: number
	unreadable: { unit: Unit; error: string }[]
}

export function planMine(
	entries: { unit: Unit; status: UnitStatus }[],
	limit?: number,
): MinePlan {
	const pending = entries.filter((e): e is Pending => e.status.kind === "pending")
	return {
		todo: limit ? pending.slice(0, limit) : pending,
		pendingTotal: pending.length,
		mined: entries.filter((e) => e.status.kind === "mined").length,
		belowThreshold: entries.filter((e) => e.status.kind === "below-threshold").length,
		unreadable: entries.flatMap((e) =>
			e.status.kind === "unreadable"
				? [{ unit: e.unit, error: e.status.error }]
				: [],
		),
	}
}

export function summarizeMinePlan(plan: MinePlan, minTurns: number): string {
	const total =
		plan.pendingTotal + plan.mined + plan.belowThreshold + plan.unreadable.length
	const limited =
		plan.todo.length !== plan.pendingTotal ? ` (mining ${plan.todo.length})` : ""
	return `${total} transcripts: ${plan.pendingTotal} pending${limited}, ${plan.mined} mined, ${plan.belowThreshold} below ${minTurns} turns, ${plan.unreadable.length} unreadable`
}

export function dryRunRow({ unit, status }: Pending): string {
	return `${status.reason.padEnd(7)} ${status.turns.toString().padStart(4)} turns  ${unit.project}/${unit.session}`
}

async function mineOneUnit(
	{ unit, status }: Pending,
	opts: MineOpts,
	run: AgentRun,
): Promise<boolean> {
	const tag = unit.session.slice(0, 8)
	const workdir = mkdtempSync(join(tmpdir(), `doublecheck-mine-${tag}-`))
	writeFileSync(
		join(workdir, PROMPT_FILE),
		composeMinePrompt(status.digest, workdir, run.cli.writeToolPhrase),
	)
	const spec = run.cli.agent({
		credentials: run.credentials,
		model: run.model,
		workdir,
	})
	process.stderr.write(
		`[${tag}] mining ${unit.project}/${unit.session} (${status.turns} turns, ${status.reason})\n`,
	)
	const outcome = await runAgent({
		mount: opts.projects,
		workdir,
		spec,
		network: { onlyDomains: run.cli.egressDomains },
		onLine: progressSink(tag, run.cli.describeStreamLine),
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
				model: run.model,
				humanTurns: status.turns,
			},
			outcome.report,
		),
	)
	process.stderr.write(`[${tag}] observations: ${obsPath}\n`)
	return true
}

// The mine workflow shell: gather statuses (I/O), plan purely, then either
// print the plan (dry-run) or run one sandboxed agent per pending unit.
// Returns true when nothing it attempted failed.
export async function runMine(opts: MineOpts): Promise<boolean> {
	const entries = enumerateUnits(opts.projects).map((unit) => ({
		unit,
		status: unitStatus(unit, opts.catalog, opts.minTurns),
	}))
	const plan = planMine(entries, opts.limit)
	for (const { unit, error } of plan.unreadable) {
		process.stderr.write(`UNREADABLE ${unit.project}/${unit.session}: ${error}\n`)
	}
	process.stderr.write(`${summarizeMinePlan(plan, opts.minTurns)}\n`)

	if (opts.dryRun) {
		for (const pending of plan.todo) console.log(dryRunRow(pending))
		return true
	}
	if (plan.todo.length === 0) return true

	const run = resolveAgentRun(opts.agent, opts.model, "mine")
	const queue = new PQueue({ concurrency: opts.parallel })
	const results = await Promise.all(
		plan.todo.map((p) => queue.add(() => mineOneUnit(p, opts, run))),
	)
	const failed = results.filter((ok) => ok !== true).length
	process.stderr.write(
		`mined ${results.length - failed}/${results.length}${failed ? `, ${failed} FAILED` : ""}\n`,
	)
	return failed === 0
}
