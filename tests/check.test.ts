import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { discoverChecks, failureReport, runTimestamp } from "../src/check.ts"

function checksDir(files: Record<string, string>): string {
	const dir = join(mkdtempSync(join(tmpdir(), "doublecheck-test-")), "checks")
	mkdirSync(dir, { recursive: true })
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(dir, name), body)
	}
	return dir
}

describe("discoverChecks", () => {
	it("finds every .md, sorted, name = filename minus .md", () => {
		const dir = checksDir({
			"beta.md": "check beta",
			"alpha.md": "check alpha",
			"notes.txt": "not a check",
		})
		expect(discoverChecks([dir], [])).toEqual([
			{ name: "alpha", body: "check alpha" },
			{ name: "beta", body: "check beta" },
		])
	})

	it("unions checks across dirs, sorted by name", () => {
		const shared = checksDir({ "zeta.md": "Z" })
		const repo = checksDir({ "alpha.md": "A" })
		expect(discoverChecks([shared, repo], []).map((c) => c.name)).toEqual([
			"alpha",
			"zeta",
		])
	})

	it("throws when the same check name exists in two dirs — no precedence", () => {
		const a = checksDir({ "dup.md": "one" })
		const b = checksDir({ "dup.md": "two" })
		expect(() => discoverChecks([a, b], [])).toThrow(
			/"dup" exists in both .* — rename one/,
		)
	})

	it("filters to the named checks, in the order named", () => {
		const dir = checksDir({ "a.md": "A", "b.md": "B", "c.md": "C" })
		expect(discoverChecks([dir], ["c", "a"]).map((c) => c.name)).toEqual(["c", "a"])
	})

	it("throws on a name that doesn't exist", () => {
		const dir = checksDir({ "a.md": "A" })
		expect(() => discoverChecks([dir], ["nope"])).toThrow(/no check named "nope"/)
	})

	it("throws when a checks dir is missing", () => {
		const missing = join(mkdtempSync(join(tmpdir(), "doublecheck-test-")), "absent")
		expect(() => discoverChecks([missing], [])).toThrow(/no checks directory/)
	})

	it("throws when the union has no .md files", () => {
		const dir = checksDir({ "readme.txt": "hi" })
		expect(() => discoverChecks([dir], [])).toThrow(/no checks \(\*\.md\)/)
	})
})

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
