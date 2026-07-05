import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { discoverChecks } from "../src/checks.ts"

function projectWithChecks(files: Record<string, string>): string {
	const project = mkdtempSync(join(tmpdir(), "doublecheck-test-"))
	const dir = join(project, ".agents", "checks")
	mkdirSync(dir, { recursive: true })
	for (const [name, body] of Object.entries(files)) {
		writeFileSync(join(dir, name), body)
	}
	return project
}

describe("discoverChecks", () => {
	it("finds every .md, sorted, name = filename minus .md", () => {
		const project = projectWithChecks({
			"beta.md": "check beta",
			"alpha.md": "check alpha",
			"notes.txt": "not a check",
		})
		expect(discoverChecks(project, [])).toEqual([
			{ name: "alpha", body: "check alpha" },
			{ name: "beta", body: "check beta" },
		])
	})

	it("filters to the named checks, in the order named", () => {
		const project = projectWithChecks({ "a.md": "A", "b.md": "B", "c.md": "C" })
		expect(discoverChecks(project, ["c", "a"]).map((c) => c.name)).toEqual(["c", "a"])
	})

	it("throws on a name that doesn't exist", () => {
		const project = projectWithChecks({ "a.md": "A" })
		expect(() => discoverChecks(project, ["nope"])).toThrow(/no check named "nope"/)
	})

	it("throws when the checks dir is missing", () => {
		const project = mkdtempSync(join(tmpdir(), "doublecheck-test-"))
		expect(() => discoverChecks(project, [])).toThrow(/no checks directory/)
	})

	it("throws when the checks dir has no .md files", () => {
		const project = projectWithChecks({ "readme.txt": "hi" })
		expect(() => discoverChecks(project, [])).toThrow(/no checks \(\*\.md\)/)
	})
})
