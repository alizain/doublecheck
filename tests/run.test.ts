import { describe, expect, it } from "vitest"
import { failureReport, runTimestamp } from "../src/run.ts"

describe("runTimestamp", () => {
	it("is fs-safe local time: YYYY-MM-DD-HHMMSS", () => {
		expect(runTimestamp(new Date(2026, 6, 5, 14, 30, 0))).toBe("2026-07-05-143000")
	})

	it("zero-pads every field", () => {
		expect(runTimestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02-030405")
	})
})

describe("failureReport", () => {
	it("records the failure reason", () => {
		const report = failureReport("agent process exited 1", null)
		expect(report).toContain("CHECK FAILED")
		expect(report).toContain("agent process exited 1")
		expect(report).not.toContain("Partial")
	})

	it("carries any partial report the agent left", () => {
		const report = failureReport("agent process exited 1", "# half-done findings")
		expect(report).toContain("# half-done findings")
	})
})
