import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { claudeAgent, describeClaudeStreamLine } from "./claude.ts"
import { codexAgent, describeCodexStreamLine, validateCodexAuth } from "./codex.ts"
import type { AgentSpec } from "./runner.ts"

// The agent CLI: the brand of agent (claude, codex) the operator picks with
// --agent, and everything the workflows need from it. Not to be confused with
// the harness (doublecheck's own mechanics) or an agent (one running
// inspector instance, described by an AgentSpec).
export interface AgentCli {
	name: string
	// Applied only when --model is absent.
	defaultModel: { check: string; mine: string }
	// The phrase the report contract uses to tell this agent how to create a
	// file; null when the prompt should just say "create <path>".
	writeToolPhrase: string | null
	// Domain suffixes for restricted-egress workflows (mine): the CLI's own
	// API endpoints, so the only reachable destination is the service the
	// agent already sends its context to.
	egressDomains: string[]
	// Host-side preflight: the secret material staged into every guest, or an
	// actionable error. Runs once per invocation, before any guest boots.
	credentials(): string
	agent(opts: { credentials: string; model: string; workdir: string }): AgentSpec
	describeStreamLine(line: string): string | null
}

const claude: AgentCli = {
	name: "claude",
	defaultModel: { check: "haiku", mine: "opus" },
	writeToolPhrase: "with the Write tool",
	egressDomains: ["anthropic.com"],
	credentials: () => {
		const token = process.env.CLAUDE_CODE_OAUTH_TOKEN
		if (!token) {
			throw new Error(
				"CLAUDE_CODE_OAUTH_TOKEN is required in the environment (it is injected into each agent's sandbox)",
			)
		}
		return token
	},
	agent: ({ credentials, model, workdir }) =>
		claudeAgent({ token: credentials, model, workdir }),
	describeStreamLine: describeClaudeStreamLine,
}

const codex: AgentCli = {
	name: "codex",
	// No haiku-style cheap default: plan billing is flat-rate, and the staged
	// guest config already pins high reasoning effort (operator decision).
	defaultModel: { check: "gpt-5.5", mine: "gpt-5.5" },
	writeToolPhrase: null,
	// ChatGPT-plan inference lives at chatgpt.com/backend-api/codex; the
	// openai.com suffix covers auth.openai.com, where a 401-forced token
	// refresh would have to go.
	egressDomains: ["chatgpt.com", "openai.com"],
	credentials: () => {
		const authPath = join(homedir(), ".codex", "auth.json")
		let content: string
		try {
			content = readFileSync(authPath, "utf-8")
		} catch {
			throw new Error(`no readable ${authPath} — run \`codex login\` on the host`)
		}
		validateCodexAuth(content, new Date(), authPath)
		return content
	},
	agent: ({ credentials, model, workdir }) =>
		codexAgent({ authJson: credentials, model, workdir }),
	describeStreamLine: describeCodexStreamLine,
}

const AGENT_CLIS: Record<string, AgentCli> = { claude, codex }

export function resolveAgentCli(name: string): AgentCli {
	const cli = AGENT_CLIS[name]
	if (!cli) {
		throw new Error(
			`unknown agent "${name}" (have: ${Object.keys(AGENT_CLIS).join(", ")})`,
		)
	}
	return cli
}

// One resolved, preflighted agent selection, shared by every unit of a run.
export interface AgentRun {
	cli: AgentCli
	credentials: string
	model: string
}

// Resolve --agent/--model into what a workflow's units consume: the CLI, its
// preflighted credentials, and the model (explicit flag, else the CLI's
// default for this workflow).
export function resolveAgentRun(
	name: string,
	model: string | undefined,
	workflow: "check" | "mine",
): AgentRun {
	const cli = resolveAgentCli(name)
	return {
		cli,
		credentials: cli.credentials(),
		model: model ?? cli.defaultModel[workflow],
	}
}

// The per-unit progress sink both workflow shells hang on runAgent: guest
// stderr passes through as `[label] ! line`, stdout is the agent CLI's JSON
// stream, labelled by its describeStreamLine (non-JSON lines dropped).
export function progressSink(
	label: string,
	describe: (line: string) => string | null,
): (kind: "stdout" | "stderr", line: string) => void {
	return (kind, line) => {
		if (kind === "stderr") {
			process.stderr.write(`[${label}] ! ${line}\n`)
			return
		}
		const described = describe(line)
		if (described) process.stderr.write(`[${label}] ${described}\n`)
	}
}
