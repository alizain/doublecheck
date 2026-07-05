import { PROMPT_FILE } from "./contract.ts"
import type { AgentSpec } from "./runner.ts"

const GUEST_HOME = "/root"

// The claude adapter: produce the AgentSpec that runs `claude -p` in the guest.
export function claudeAgent(opts: {
	token: string
	model: string
	workdir: string
}): AgentSpec {
	return {
		// Headless claude -p cannot answer permission prompts, so in "default"
		// mode every tool is auto-denied and the agent produces nothing. The
		// microVM is the safety boundary here, so bypass the per-tool gate;
		// IS_SANDBOX=1 is what lets that run as root without claude's refusal.
		command:
			"claude -p --no-session-persistence " +
			"--dangerously-skip-permissions " +
			// --verbose is required by claude -p with stream-json output; it only
			// widens what lands on stdout, which describeStreamLine already labels.
			"--output-format stream-json --verbose " +
			// Not a permission gate — a contract guard. The default headless tool
			// set omits Glob/Grep and includes harness tools (ReportFindings,
			// TaskCreate, …) that hijack the report: haiku "reports findings"
			// through them and never writes report.md (verified live). This pins
			// the inspector's full toolkit and nothing else.
			`--tools Task Bash Read Write Edit Glob Grep WebSearch WebFetch < ${PROMPT_FILE}`,
		env: {
			HOME: GUEST_HOME,
			IS_SANDBOX: "1",
			GIT_OPTIONAL_LOCKS: "0",
			ANTHROPIC_MODEL: opts.model,
			CLAUDE_CODE_OAUTH_TOKEN: opts.token,
		},
		// Minimal trust-accepted entry keyed to the guest cwd so headless claude
		// skips the trust prompt. Deliberately NOT a copy of any host .claude.json.
		files: [
			{
				path: `${GUEST_HOME}/.claude.json`,
				content: `${JSON.stringify(
					{ projects: { [opts.workdir]: { hasTrustDialogAccepted: true } } },
					null,
					"\t",
				)}\n`,
			},
		],
	}
}

interface StreamLine {
	type?: string
	subtype?: string
	message?: { content?: Array<{ text?: string }> }
	duration_ms?: number
}

// One human-readable label per stream-json stdout line; null for lines that
// aren't claude's JSON (dropped from the progress stream).
export function describeStreamLine(line: string): string | null {
	let obj: StreamLine
	try {
		obj = JSON.parse(line) as StreamLine
	} catch {
		return null
	}
	const label = (obj.type ?? "") + (obj.subtype ? `:${obj.subtype}` : "")
	// A once-per-second heartbeat with no content — pure noise in the stream.
	if (label === "system:thinking_tokens") return null
	let detail = ""
	if (obj.type === "assistant") {
		detail = ` ${obj.message?.content?.[0]?.text?.length ?? 0} chars`
	} else if (obj.type === "result") {
		detail = ` ${obj.subtype}, ${((obj.duration_ms ?? 0) / 1000).toFixed(1)}s`
	}
	return `[${label}]${detail}`
}
