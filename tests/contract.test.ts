import { describe, expect, it } from "vitest"
import { composePrompt, REPORT_FILE } from "../src/contract.ts"

describe("composePrompt", () => {
	const prompt = composePrompt("INSPECT ALL THE THINGS", "/some/project")

	it("carries the check body verbatim between environment and report contract", () => {
		expect(prompt).toContain("INSPECT ALL THE THINGS")
		expect(prompt.indexOf("## Environment")).toBeLessThan(
			prompt.indexOf("INSPECT ALL THE THINGS"),
		)
		expect(prompt.indexOf("INSPECT ALL THE THINGS")).toBeLessThan(
			prompt.indexOf("## Report"),
		)
	})

	it("names the read-only project mount and the report contract", () => {
		expect(prompt).toContain("`/some/project`")
		expect(prompt).toContain("read-only")
		expect(prompt).toContain(`./${REPORT_FILE}`)
	})
})
