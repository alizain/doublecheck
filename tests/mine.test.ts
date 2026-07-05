import { describe, expect, it } from "vitest"
import type { Unit, UnitStatus } from "../src/catalog.ts"
import { dryRunRow, planMine, summarizeMinePlan } from "../src/mine.ts"

const unit = (session: string): Unit => ({
	project: "proj",
	session,
	jsonlPath: `/p/proj/${session}.jsonl`,
})
const pending = (session: string, reason: "new" | "changed", turns = 5) => ({
	unit: unit(session),
	status: {
		kind: "pending",
		reason,
		turns,
		digest: "d",
		sourceSha256: "a".repeat(64),
	} satisfies UnitStatus,
})

const ENTRIES = [
	pending("s1", "new"),
	{ unit: unit("s2"), status: { kind: "mined" } satisfies UnitStatus },
	pending("s3", "changed", 12),
	{
		unit: unit("s4"),
		status: { kind: "below-threshold", turns: 1 } satisfies UnitStatus,
	},
	{
		unit: unit("s5"),
		status: { kind: "unreadable", error: "boom" } satisfies UnitStatus,
	},
]

describe("planMine", () => {
	it("selects pending units and counts the rest", () => {
		const plan = planMine(ENTRIES)
		expect(plan.todo.map((p) => p.unit.session)).toEqual(["s1", "s3"])
		expect(plan).toMatchObject({ pendingTotal: 2, mined: 1, belowThreshold: 1 })
		expect(plan.unreadable).toEqual([{ unit: unit("s5"), error: "boom" }])
	})

	it("limit caps todo but not the pending count", () => {
		const plan = planMine(ENTRIES, 1)
		expect(plan.todo.map((p) => p.unit.session)).toEqual(["s1"])
		expect(plan.pendingTotal).toBe(2)
	})
})

describe("summarizeMinePlan", () => {
	it("summarizes all buckets, noting an applied limit", () => {
		expect(summarizeMinePlan(planMine(ENTRIES), 2)).toBe(
			"5 transcripts: 2 pending, 1 mined, 1 below 2 turns, 1 unreadable",
		)
		expect(summarizeMinePlan(planMine(ENTRIES, 1), 2)).toBe(
			"5 transcripts: 2 pending (mining 1), 1 mined, 1 below 2 turns, 1 unreadable",
		)
	})
})

describe("dryRunRow", () => {
	it("renders reason, turns, and unit path", () => {
		expect(dryRunRow(pending("s3", "changed", 12))).toBe(
			"changed   12 turns  proj/s3",
		)
	})
})
