import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { basename, join } from "node:path"
import { humanTurns, renderDigest } from "./transcript.ts"

// One minable unit = one top-level transcript $PROJECTS/<project>/<session>.jsonl.
// Its catalog home mirrors that path: $CATALOG/<project>/<session>/observations.md.
export interface Unit {
	project: string
	session: string
	jsonlPath: string
}

export function enumerateUnits(projectsDir: string): Unit[] {
	let projects: string[]
	try {
		projects = readdirSync(projectsDir).sort()
	} catch {
		throw new Error(`no transcripts directory at ${projectsDir}`)
	}
	const units: Unit[] = []
	for (const project of projects) {
		const dir = join(projectsDir, project)
		if (!statSync(dir).isDirectory()) continue
		for (const f of readdirSync(dir).sort()) {
			if (!f.endsWith(".jsonl")) continue
			units.push({
				project,
				session: basename(f, ".jsonl"),
				jsonlPath: join(dir, f),
			})
		}
	}
	return units
}

export function observationsPath(catalogDir: string, unit: Unit): string {
	return join(catalogDir, unit.project, unit.session, "observations.md")
}

export type UnitStatus =
	// hash matches the recorded source_sha256 — skipped without parsing
	| { kind: "mined" }
	| { kind: "below-threshold"; turns: number }
	| {
			kind: "pending"
			reason: "new" | "changed"
			turns: number
			digest: string
			sourceSha256: string
	  }
	// transcript has an unparseable line; reported visibly, never mined
	| { kind: "unreadable"; error: string }

// Pure decision core: everything already read, nothing left but judgment.
export function decideUnitStatus(input: {
	unit: Unit
	jsonl: Buffer
	recordedSha256: string | null
	minTurns: number
}): UnitStatus {
	const sourceSha256 = createHash("sha256").update(input.jsonl).digest("hex")
	if (input.recordedSha256 === sourceSha256) return { kind: "mined" }
	let turns: string[]
	try {
		turns = humanTurns(input.jsonl.toString("utf-8"))
	} catch (e) {
		return { kind: "unreadable", error: String(e) }
	}
	if (turns.length < input.minTurns)
		return { kind: "below-threshold", turns: turns.length }
	return {
		kind: "pending",
		reason: input.recordedSha256 === null ? "new" : "changed",
		turns: turns.length,
		digest: renderDigest(
			{
				source: input.unit.jsonlPath,
				project: input.unit.project,
				session: input.unit.session,
			},
			turns,
		),
		sourceSha256,
	}
}

// Shell: read the unit's inputs, then decide purely.
export function unitStatus(unit: Unit, catalogDir: string, minTurns: number): UnitStatus {
	const obsPath = observationsPath(catalogDir, unit)
	return decideUnitStatus({
		unit,
		jsonl: readFileSync(unit.jsonlPath),
		recordedSha256: existsSync(obsPath)
			? readSourceSha256(readFileSync(obsPath, "utf-8"))
			: null,
		minTurns,
	})
}

export interface ObservationsMeta {
	source: string
	sourceSha256: string
	minedAt: string
	model: string
	humanTurns: number
}

// The host composes the final file: frontmatter it alone can vouch for, then
// the agent's report verbatim.
export function composeObservationsFile(meta: ObservationsMeta, body: string): string {
	return `---
source: ${meta.source}
source_sha256: ${meta.sourceSha256}
mined_at: ${meta.minedAt}
model: ${meta.model}
human_turns: ${meta.humanTurns}
---

${body.trimEnd()}
`
}

export function readSourceSha256(observationsMd: string): string | null {
	return observationsMd.match(/^source_sha256: ([0-9a-f]{64})$/m)?.[1] ?? null
}
