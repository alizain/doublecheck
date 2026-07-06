import { afterEach, describe, expect, it, vi } from "vitest"
import { progressSink, resolveAgentCli, resolveAgentRun } from "../src/agent-cli.ts"

describe("resolveAgentCli", () => {
	it("knows claude and codex, with their write-tool phrases", () => {
		expect(resolveAgentCli("claude").writeToolPhrase).toBe("with the Write tool")
		expect(resolveAgentCli("codex").writeToolPhrase).toBeNull()
	})

	it("carries per-workflow model defaults", () => {
		expect(resolveAgentCli("claude").defaultModel).toEqual({
			check: "haiku",
			mine: "opus",
		})
		expect(resolveAgentCli("codex").defaultModel).toEqual({
			check: "gpt-5.5",
			mine: "gpt-5.5",
		})
	})

	it("rejects an unknown agent, listing the known ones", () => {
		expect(() => resolveAgentCli("gemini")).toThrow(
			/unknown agent "gemini" \(have: claude, codex\)/,
		)
	})
})

describe("resolveAgentRun", () => {
	afterEach(() => vi.unstubAllEnvs())

	it("preflights credentials and applies the workflow's default model", () => {
		vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "tok-abc")
		expect(resolveAgentRun("claude", undefined, "check")).toMatchObject({
			credentials: "tok-abc",
			model: "haiku",
		})
		expect(resolveAgentRun("claude", undefined, "mine").model).toBe("opus")
	})

	it("lets an explicit --model win over the default", () => {
		vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "tok-abc")
		expect(resolveAgentRun("claude", "sonnet", "check").model).toBe("sonnet")
	})

	it("fails the claude preflight without a token", () => {
		vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "")
		expect(() => resolveAgentRun("claude", undefined, "check")).toThrow(
			/CLAUDE_CODE_OAUTH_TOKEN is required/,
		)
	})
})

describe("progressSink", () => {
	it("labels described stdout, drops undescribed stdout, passes stderr through", () => {
		const written: string[] = []
		const spy = vi
			.spyOn(process.stderr, "write")
			.mockImplementation((chunk: unknown) => {
				written.push(String(chunk))
				return true
			})
		const sink = progressSink("my-check", (line) =>
			line === "described" ? "[label]" : null,
		)
		sink("stdout", "described")
		sink("stdout", "dropped")
		sink("stderr", "guest noise")
		spy.mockRestore()
		expect(written).toEqual(["[my-check] [label]\n", "[my-check] ! guest noise\n"])
	})
})
