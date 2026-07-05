import { describe, expect, it } from "vitest"
import { humanTurns, renderDigest } from "../src/transcript.ts"

const line = (obj: object) => JSON.stringify(obj)
const user = (content: unknown, extra: object = {}) =>
	line({ type: "user", message: { content }, ...extra })

describe("humanTurns", () => {
	it("keeps plain human text turns", () => {
		const jsonl = [
			line({ type: "summary", summary: "hi" }),
			user("fix the bug"),
			line({
				type: "assistant",
				message: { content: [{ type: "text", text: "ok" }] },
			}),
			user("no, the OTHER bug"),
		].join("\n")
		expect(humanTurns(jsonl)).toEqual(["fix the bug", "no, the OTHER bug"])
	})

	it("drops meta, sidechain, and non-user lines", () => {
		const jsonl = [
			user("real turn"),
			user("meta turn", { isMeta: true }),
			user("sidechain turn", { isSidechain: true }),
			line({ type: "mode", mode: "normal" }),
		].join("\n")
		expect(humanTurns(jsonl)).toEqual(["real turn"])
	})

	it("keeps only text items from array content (drops tool_results)", () => {
		const jsonl = user([
			{ type: "tool_result", tool_use_id: "x", content: "result blob" },
			{ type: "text", text: "actual human words" },
		])
		expect(humanTurns(jsonl)).toEqual(["actual human words"])
	})

	it("drops slash-command wrappers, system-reminders, and caveat blocks", () => {
		const jsonl = [
			user("<command-name>/context</command-name>"),
			user("  <system-reminder>injected</system-reminder>"),
			user("<local-command-stdout>out</local-command-stdout>"),
			user("Caveat: The messages below were generated..."),
			user("keep me"),
		].join("\n")
		expect(humanTurns(jsonl)).toEqual(["keep me"])
	})

	it("flattens newlines and caps turn length", () => {
		const long = `first\nsecond\r\nthird${"x".repeat(3000)}`
		const [turn] = humanTurns(user(long))
		expect(turn).toContain("first ⏎ second ⏎ third")
		expect(turn?.length).toBe(2000)
	})

	it("throws on an unparseable line", () => {
		expect(() => humanTurns('{"type":"user"\nnot json')).toThrow()
	})
})

describe("renderDigest", () => {
	it("renders header with source path and numbered turns", () => {
		const digest = renderDigest(
			{ source: "/p/proj/sess.jsonl", project: "proj", session: "sess" },
			["turn one", "turn two"],
		)
		expect(digest).toContain("# source:  /p/proj/sess.jsonl")
		expect(digest).toContain("# human_turns: 2")
		expect(digest).toContain("  1  | turn one")
		expect(digest).toContain("  2  | turn two")
	})
})
