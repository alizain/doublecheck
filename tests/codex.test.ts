import { describe, expect, it } from "vitest"
import { codexAgent, describeCodexStreamLine, validateCodexAuth } from "../src/codex.ts"

describe("codexAgent", () => {
	const spec = codexAgent({
		authJson: '{"tokens":{"refresh_token":"rt-123"}}',
		model: "gpt-5.5",
		workdir: "/tmp/w",
	})

	it("runs headless codex reading the staged prompt from stdin, no session files", () => {
		expect(spec.command).toContain("codex exec --json")
		expect(spec.command).toContain("--skip-git-repo-check")
		expect(spec.command).toContain("--dangerously-bypass-approvals-and-sandbox")
		expect(spec.command).toContain("--ephemeral")
		expect(spec.command).toContain("- < prompt.txt")
		// The model rides in the staged config, never interpolated into bash.
		expect(spec.command).not.toContain("gpt-5.5")
	})

	it("sets only the home codex needs — auth is a staged file, not an env var", () => {
		expect(spec.env).toEqual({ HOME: "/root", GIT_OPTIONAL_LOCKS: "0" })
	})

	it("stages the host auth.json byte-for-byte under CODEX_HOME", () => {
		const auth = spec.files.find((f) => f.path === "/root/.codex/auth.json")
		expect(auth?.content).toBe('{"tokens":{"refresh_token":"rt-123"}}')
	})

	it("stages a minimal guest config: model, no plugins/apps fetch, no AGENTS.md, xhigh effort", () => {
		expect(spec.files).toHaveLength(2)
		const config = spec.files.find((f) => f.path === "/root/.codex/config.toml")
		expect(config?.content).toContain('model = "gpt-5.5"')
		expect(config?.content).toContain('approval_policy = "never"')
		expect(config?.content).toContain('sandbox_mode = "danger-full-access"')
		expect(config?.content).toContain('model_reasoning_effort = "xhigh"')
		expect(config?.content).toContain('web_search = "live"')
		expect(config?.content).toContain("project_doc_max_bytes = 0")
		expect(config?.content).toContain('cli_auth_credentials_store = "file"')
		expect(config?.content).toContain("plugins = false")
		expect(config?.content).toContain("apps = false")
	})
})

describe("validateCodexAuth", () => {
	const now = new Date("2026-07-06T00:00:00Z")
	const chatgptAuth = (lastRefresh: string | undefined) =>
		JSON.stringify({
			auth_mode: "chatgpt",
			tokens: { refresh_token: "rt", access_token: "at", id_token: "jwt" },
			...(lastRefresh === undefined ? {} : { last_refresh: lastRefresh }),
		})

	it("accepts freshly refreshed ChatGPT tokens", () => {
		expect(() =>
			validateCodexAuth(chatgptAuth("2026-07-05T12:00:00Z"), now, "auth.json"),
		).not.toThrow()
	})

	it("rejects tokens older than the guard window — a guest-side refresh would poison the host session", () => {
		expect(() =>
			validateCodexAuth(chatgptAuth("2026-06-28T00:00:00Z"), now, "auth.json"),
		).toThrow(/run any codex command on the host to refresh/)
	})

	it("rejects ChatGPT tokens with no last_refresh at all", () => {
		expect(() => validateCodexAuth(chatgptAuth(undefined), now, "auth.json")).toThrow(
			/refresh/,
		)
	})

	it("accepts an api-key-mode auth.json without any staleness guard", () => {
		const auth = JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "sk-x" })
		expect(() => validateCodexAuth(auth, now, "auth.json")).not.toThrow()
	})

	it("rejects non-JSON and credential-less files with a next action", () => {
		expect(() => validateCodexAuth("not json", now, "auth.json")).toThrow(
			/codex login/,
		)
		expect(() => validateCodexAuth("{}", now, "auth.json")).toThrow(
			/neither ChatGPT tokens nor an API key/,
		)
	})
})

// Fixtures are lines captured verbatim from a live `codex exec --json` run
// (codex-cli 0.139.0, 2026-07-05) — not hand-written guesses.
describe("describeCodexStreamLine", () => {
	it("labels thread and turn lifecycle lines", () => {
		expect(
			describeCodexStreamLine(
				'{"type":"thread.started","thread_id":"019f354c-4391-7c10-8b2c-c27ccb168581"}',
			),
		).toBe("[thread.started]")
		expect(describeCodexStreamLine('{"type":"turn.started"}')).toBe("[turn.started]")
	})

	it("labels command executions with the truncated command", () => {
		const line = JSON.stringify({
			type: "item.started",
			item: {
				id: "item_0",
				type: "command_execution",
				command: "/opt/homebrew/bin/zsh -lc 'pwd && ls'",
				aggregated_output: "",
				exit_code: null,
				status: "in_progress",
			},
		})
		expect(describeCodexStreamLine(line)).toBe(
			"[item.started:command_execution] /opt/homebrew/bin/zsh -lc 'pwd && ls'",
		)
	})

	it("truncates long commands", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: { type: "command_execution", command: "x".repeat(80) },
		})
		expect(describeCodexStreamLine(line)).toBe(
			`[item.completed:command_execution] ${"x".repeat(60)}…`,
		)
	})

	it("labels file changes with the file count", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: {
				id: "item_1",
				type: "file_change",
				changes: [{ path: "/tmp/w/report.md", kind: "add" }],
				status: "completed",
			},
		})
		expect(describeCodexStreamLine(line)).toBe(
			"[item.completed:file_change] 1 file(s)",
		)
	})

	it("labels the final agent message with its text length", () => {
		const line = JSON.stringify({
			type: "item.completed",
			item: { id: "item_2", type: "agent_message", text: "done" },
		})
		expect(describeCodexStreamLine(line)).toBe(
			"[item.completed:agent_message] 4 chars",
		)
	})

	it("labels turn completion with token usage", () => {
		const line = JSON.stringify({
			type: "turn.completed",
			usage: {
				input_tokens: 75394,
				cached_input_tokens: 33920,
				output_tokens: 96,
				reasoning_output_tokens: 19,
			},
		})
		expect(describeCodexStreamLine(line)).toBe(
			"[turn.completed] 75394 in, 96 out tokens",
		)
	})

	it("labels failures with their message", () => {
		expect(
			describeCodexStreamLine(
				'{"type":"turn.failed","error":{"message":"stream disconnected"}}',
			),
		).toBe("[turn.failed] stream disconnected")
		expect(describeCodexStreamLine('{"type":"error","message":"boom"}')).toBe(
			"[error] boom",
		)
	})

	it("returns null for non-JSON lines", () => {
		expect(describeCodexStreamLine("plain text")).toBeNull()
	})
})
