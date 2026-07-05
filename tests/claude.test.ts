import { describe, expect, it } from "vitest"
import { claudeAgent, describeStreamLine } from "../src/claude.ts"

describe("claudeAgent", () => {
	const spec = claudeAgent({ token: "tok-123", model: "haiku", workdir: "/tmp/w" })

	it("runs headless claude reading the staged prompt, writing no session", () => {
		expect(spec.command).toContain("claude -p")
		expect(spec.command).toContain("--dangerously-skip-permissions")
		expect(spec.command).toContain("--output-format stream-json --verbose")
		expect(spec.command).toContain("< prompt.txt")
	})

	it("injects token, model, and the sandbox/root env claude needs", () => {
		expect(spec.env).toMatchObject({
			CLAUDE_CODE_OAUTH_TOKEN: "tok-123",
			ANTHROPIC_MODEL: "haiku",
			IS_SANDBOX: "1",
			HOME: "/root",
			GIT_OPTIONAL_LOCKS: "0",
		})
	})

	it("stages only a minimal trust-accepted .claude.json keyed to the workdir", () => {
		expect(spec.files).toHaveLength(1)
		const file = spec.files[0]
		expect(file?.path).toBe("/root/.claude.json")
		expect(JSON.parse(file?.content ?? "")).toEqual({
			projects: { "/tmp/w": { hasTrustDialogAccepted: true } },
		})
	})
})

describe("describeStreamLine", () => {
	it("labels assistant lines with text length", () => {
		const line = JSON.stringify({
			type: "assistant",
			message: { content: [{ text: "hello" }] },
		})
		expect(describeStreamLine(line)).toBe("[assistant] 5 chars")
	})

	it("labels result lines with subtype and duration", () => {
		const line = JSON.stringify({
			type: "result",
			subtype: "success",
			duration_ms: 12500,
		})
		expect(describeStreamLine(line)).toBe("[result:success] success, 12.5s")
	})

	it("returns null for non-JSON lines", () => {
		expect(describeStreamLine("plain text")).toBeNull()
	})
})
