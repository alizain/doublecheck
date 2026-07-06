import { describe, expect, it } from "vitest"
import { DEV_VERSION, decideGuestImage, decideOutcome, feedLines } from "../src/runner.ts"

describe("decideGuestImage", () => {
	it("a released version pulls its matching ghcr image if missing", () => {
		expect(decideGuestImage("2.2.0")).toEqual({
			ref: "ghcr.io/alizain/doublecheck-guest:2.2.0",
			pullPolicy: "if-missing",
		})
	})

	it("a dev tree pulls the release its checkout descends from", () => {
		expect(decideGuestImage(DEV_VERSION, undefined, "2.2.0")).toEqual({
			ref: "ghcr.io/alizain/doublecheck-guest:2.2.0",
			pullPolicy: "if-missing",
		})
	})

	it("a dev tree with no reachable release tag uses the locally built image, never pulled", () => {
		expect(decideGuestImage(DEV_VERSION, undefined, null)).toEqual({
			ref: "doublecheck-guest:latest",
			pullPolicy: "never",
		})
	})

	it("an operator override is used as-is and never pulled", () => {
		expect(decideGuestImage("2.2.0", "my-image:custom")).toEqual({
			ref: "my-image:custom",
			pullPolicy: "never",
		})
	})

	it("an empty override does not count as an override", () => {
		expect(decideGuestImage(DEV_VERSION, "").ref).toBe("doublecheck-guest:latest")
	})
})

describe("feedLines", () => {
	it("emits complete lines and carries the unterminated tail", () => {
		expect(feedLines("", "a\nb\npart")).toEqual({ lines: ["a", "b"], carry: "part" })
	})

	it("joins a carried tail with the next chunk", () => {
		const first = feedLines("", '{"type":"assis')
		expect(first.lines).toEqual([])
		expect(feedLines(first.carry, 'tant"}\n')).toEqual({
			lines: ['{"type":"assistant"}'],
			carry: "",
		})
	})

	it("drops blank lines", () => {
		expect(feedLines("", "a\n\n  \nb\n").lines).toEqual(["a", "b"])
	})
})

describe("decideOutcome", () => {
	it("success needs exit 0 AND a report", () => {
		expect(decideOutcome(0, "# findings", "/w")).toEqual({
			ok: true,
			report: "# findings",
		})
	})

	it("non-zero exit keeps any partial report", () => {
		expect(decideOutcome(3, "partial", "/w")).toEqual({
			ok: false,
			reason: "agent process exited 3",
			partialReport: "partial",
		})
	})

	it("a stream that never reported an exit code is a failure, not a success", () => {
		expect(decideOutcome(null, "report", "/w")).toMatchObject({ ok: false })
	})

	it("exit 0 without a report names the workdir", () => {
		const outcome = decideOutcome(0, null, "/scratch/x")
		expect(outcome.ok === false && outcome.reason).toContain("/scratch/x")
	})
})
