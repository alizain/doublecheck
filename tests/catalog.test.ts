import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
	composeObservationsFile,
	enumerateUnits,
	observationsPath,
	readSourceSha256,
	type Unit,
	unitStatus,
} from "../src/catalog.ts"

const userTurn = (text: string) =>
	JSON.stringify({ type: "user", message: { content: text } })

function corpus(files: Record<string, string>): string {
	const dir = mkdtempSync(join(tmpdir(), "doublecheck-corpus-"))
	for (const [rel, content] of Object.entries(files)) {
		mkdirSync(join(dir, rel, ".."), { recursive: true })
		writeFileSync(join(dir, rel), content)
	}
	return dir
}

const TWO_TURNS = [userTurn("first ask"), userTurn("a correction")].join("\n")

describe("enumerateUnits", () => {
	it("finds project/session.jsonl pairs, sorted, ignoring non-jsonl", () => {
		const projects = corpus({
			"proj-b/sess-1.jsonl": TWO_TURNS,
			"proj-a/sess-2.jsonl": TWO_TURNS,
			"proj-a/sess-1.jsonl": TWO_TURNS,
			"proj-a/notes.txt": "not a transcript",
		})
		expect(enumerateUnits(projects).map((u) => `${u.project}/${u.session}`)).toEqual([
			"proj-a/sess-1",
			"proj-a/sess-2",
			"proj-b/sess-1",
		])
	})

	it("throws when the transcripts dir is missing", () => {
		expect(() => enumerateUnits("/nope/nothing")).toThrow(/no transcripts directory/)
	})
})

describe("unitStatus", () => {
	function setup(jsonl: string): { unit: Unit; catalog: string } {
		const projects = corpus({ "proj/sess.jsonl": jsonl })
		const [unit] = enumerateUnits(projects)
		if (!unit) throw new Error("no unit")
		return { unit, catalog: mkdtempSync(join(tmpdir(), "doublecheck-cat-")) }
	}

	it("pending/new for an unmined multi-turn conversation, with digest", () => {
		const { unit, catalog } = setup(TWO_TURNS)
		const status = unitStatus(unit, catalog, 2)
		expect(status).toMatchObject({ kind: "pending", reason: "new", turns: 2 })
		if (status.kind === "pending") {
			expect(status.digest).toContain("  1  | first ask")
			expect(status.sourceSha256).toMatch(/^[0-9a-f]{64}$/)
		}
	})

	it("mined when the recorded hash matches; changed when it doesn't", () => {
		const { unit, catalog } = setup(TWO_TURNS)
		const status = unitStatus(unit, catalog, 2)
		if (status.kind !== "pending") throw new Error("expected pending")
		const obsPath = observationsPath(catalog, unit)
		mkdirSync(join(obsPath, ".."), { recursive: true })
		writeFileSync(
			obsPath,
			composeObservationsFile(
				{
					source: unit.jsonlPath,
					sourceSha256: status.sourceSha256,
					minedAt: "2026-07-05T21:00:00Z",
					model: "opus",
					humanTurns: 2,
				},
				"## some-observation\n- **observation:** x",
			),
		)
		expect(unitStatus(unit, catalog, 2)).toEqual({ kind: "mined" })

		writeFileSync(unit.jsonlPath, `${TWO_TURNS}\n${userTurn("session resumed")}`)
		expect(unitStatus(unit, catalog, 2)).toMatchObject({
			kind: "pending",
			reason: "changed",
			turns: 3,
		})
	})

	it("below-threshold for one-turn (headless-style) sessions", () => {
		const { unit, catalog } = setup(userTurn("one-shot prompt"))
		expect(unitStatus(unit, catalog, 2)).toEqual({
			kind: "below-threshold",
			turns: 1,
		})
	})

	it("unreadable for a transcript with a corrupt line", () => {
		const { unit, catalog } = setup(`${userTurn("ok")}\n{truncated`)
		expect(unitStatus(unit, catalog, 2)).toMatchObject({ kind: "unreadable" })
	})
})

describe("observations file", () => {
	it("frontmatter roundtrips through readSourceSha256", () => {
		const sha = "a".repeat(64)
		const md = composeObservationsFile(
			{
				source: "/x/y.jsonl",
				sourceSha256: sha,
				minedAt: "2026-07-05T21:00:00Z",
				model: "opus",
				humanTurns: 7,
			},
			"## obs",
		)
		expect(readSourceSha256(md)).toBe(sha)
		expect(md).toContain("human_turns: 7")
		expect(md.endsWith("## obs\n")).toBe(true)
	})
})
