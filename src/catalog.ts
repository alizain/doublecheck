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

export function unitStatus(unit: Unit, catalogDir: string, minTurns: number): UnitStatus {
	const jsonl = readFileSync(unit.jsonlPath)
	const sourceSha256 = createHash("sha256").update(jsonl).digest("hex")
	const obsPath = observationsPath(catalogDir, unit)
	const recorded = existsSync(obsPath)
		? readSourceSha256(readFileSync(obsPath, "utf-8"))
		: null
	if (recorded === sourceSha256) return { kind: "mined" }
	let turns: string[]
	try {
		turns = humanTurns(jsonl.toString("utf-8"))
	} catch (e) {
		return { kind: "unreadable", error: String(e) }
	}
	if (turns.length < minTurns) return { kind: "below-threshold", turns: turns.length }
	return {
		kind: "pending",
		reason: recorded === null ? "new" : "changed",
		turns: turns.length,
		digest: renderDigest(
			{ source: unit.jsonlPath, project: unit.project, session: unit.session },
			turns,
		),
		sourceSha256,
	}
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
