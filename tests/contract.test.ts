import { describe, expect, it } from "vitest"
import { composeMinePrompt, composePrompt, REPORT_FILE } from "../src/contract.ts"

describe("composePrompt", () => {
	const prompt = composePrompt({
		checkBody: "INSPECT ALL THE THINGS",
		target: "/some/target",
		workdir: "/scratch/wd",
		runContext: null,
	})

	it("carries the check body verbatim between environment and report contract", () => {
		expect(prompt).toContain("INSPECT ALL THE THINGS")
		expect(prompt.indexOf("## Environment")).toBeLessThan(
			prompt.indexOf("INSPECT ALL THE THINGS"),
		)
		expect(prompt.indexOf("INSPECT ALL THE THINGS")).toBeLessThan(
			prompt.indexOf("## Report"),
		)
	})

	it("names the read-only target mount and the report contract", () => {
		expect(prompt).toContain("`/some/target`")
		expect(prompt).toContain("read-only")
		expect(prompt).toContain(`/scratch/wd/${REPORT_FILE}`)
	})

	it("orders report creation FIRST, near the top, at the absolute workdir path", () => {
		const firstAction = prompt.indexOf("Your FIRST action")
		expect(firstAction).toBeGreaterThan(-1)
		expect(firstAction).toBeLessThan(prompt.indexOf("INSPECT ALL THE THINGS"))
		expect(prompt.indexOf(`/scratch/wd/${REPORT_FILE}`)).toBeLessThan(
			prompt.indexOf("INSPECT ALL THE THINGS"),
		)
	})

	it("tells the inspector every report line is read and 'no findings' is acceptable", () => {
		expect(prompt).toContain("read in full")
		expect(prompt).toContain('"no findings"')
	})

	it("imposes inspection discipline before the check body: ledger, licensed verbs, no truncation", () => {
		const discipline = prompt.indexOf("## Inspection discipline")
		expect(discipline).toBeGreaterThan(-1)
		expect(discipline).toBeLessThan(prompt.indexOf("INSPECT ALL THE THINGS"))
		expect(prompt).toContain("ONLY for actions you actually performed")
		expect(prompt).toContain("labeled as inference")
		expect(prompt).toContain("Never truncate")
	})

	it("framing scopes findings to the change but lets retired-concept survivors be reported tree-wide", () => {
		const withContext = composePrompt({
			checkBody: "CHECK",
			target: "/t",
			workdir: "/w",
			runContext: "## Scope\n\nfile.ts",
		})
		expect(withContext).toContain("not where survivors may hide")
	})

	it("has no run-context section when none is given", () => {
		expect(prompt).not.toContain("## Run context")
	})

	it("splices run context between environment and check body, with framing", () => {
		const withContext = composePrompt({
			checkBody: "INSPECT ALL THE THINGS",
			target: "/some/target",
			workdir: "/scratch/wd",
			runContext:
				"## Intent\n\nShip the v3 cutover.\n\n## Scope\n\npackages/engine/lib/engine.ts",
		})
		expect(withContext.indexOf("## Environment")).toBeLessThan(
			withContext.indexOf("## Run context (from the operator)"),
		)
		expect(withContext.indexOf("## Run context (from the operator)")).toBeLessThan(
			withContext.indexOf("Ship the v3 cutover."),
		)
		expect(withContext.indexOf("Ship the v3 cutover.")).toBeLessThan(
			withContext.indexOf("INSPECT ALL THE THINGS"),
		)
		expect(withContext).toContain("sanctioned exceptions")
	})
})

describe("composeMinePrompt", () => {
	it("orders report creation first at the absolute workdir path", () => {
		const prompt = composeMinePrompt("TURN 1: hello", "/scratch/mine")
		expect(prompt).toContain(`/scratch/mine/${REPORT_FILE}`)
		expect(prompt.indexOf("Your FIRST action")).toBeLessThan(
			prompt.indexOf("TURN 1: hello"),
		)
	})
})
