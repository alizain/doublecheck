import { PROMPT_FILE } from "./contract.ts"
import type { AgentSpec } from "./runner.ts"

const GUEST_HOME = "/root"

// Guest-only codex config — deliberately NOT a copy of any host config.toml
// (which carries MCP API keys, personality, plugins, a trust table). Each key
// is load-bearing:
// - model rides here rather than as a `-m` flag so nothing operator-supplied
//   is ever interpolated into the guest's bash command string.
// - approval_policy/sandbox_mode double the bypass flag on the command line;
//   either alone is a documented trust-prompt suppressor, some builds leak
//   with only one (openai/codex#14547).
// - model_reasoning_effort: operator decision — plan billing is flat-rate,
//   so there is no haiku-style cost gradient to encode in a cheaper setting.
// - web_search is a server-side tool (the guest never fetches pages itself);
//   "live" pins it rather than relying on the full-access auto-upgrade.
// - project_doc_max_bytes = 0 disables all AGENTS.md loading: the piped
//   prompt is the agent's only input.
// - features.plugins/apps = false stop codex's boot-time marketplace clone
//   and apps fetch (verified live): under restricted egress they hang, and
//   under any egress they inject tools (e.g. a git-push skill) the contract
//   never sanctioned.
function guestConfig(model: string): string {
	return `model = "${model}"
approval_policy = "never"
sandbox_mode = "danger-full-access"
model_reasoning_effort = "xhigh"
web_search = "live"
project_doc_max_bytes = 0
cli_auth_credentials_store = "file"

[features]
plugins = false
apps = false
`
}

// The codex adapter: produce the AgentSpec that runs `codex exec` in the guest.
export function codexAgent(opts: {
	// Byte-for-byte content of the operator's ~/.codex/auth.json; staleness is
	// the caller's preflight (a guest-side token refresh would rotate the
	// single-use refresh token and poison the host session).
	authJson: string
	model: string
	workdir: string
}): AgentSpec {
	return {
		// Headless codex cannot answer approval prompts, and its own bwrap
		// sandbox needs user namespaces the guest may not grant — the microVM is
		// the safety boundary, so bypass both (OpenAI's documented container
		// guidance). --ephemeral writes no session rollout files;
		// --skip-git-repo-check because the scratch cwd is not a git repo.
		command:
			"codex exec --json --skip-git-repo-check " +
			"--dangerously-bypass-approvals-and-sandbox --ephemeral " +
			`- < ${PROMPT_FILE}`,
		env: {
			// CODEX_HOME defaults to $HOME/.codex, where both staged files land.
			HOME: GUEST_HOME,
			GIT_OPTIONAL_LOCKS: "0",
		},
		files: [
			{ path: `${GUEST_HOME}/.codex/auth.json`, content: opts.authJson },
			{
				path: `${GUEST_HOME}/.codex/config.toml`,
				content: guestConfig(opts.model),
			},
		],
	}
}

// The freshness window for a staged ChatGPT-auth auth.json. Codex refreshes
// tokens when last_refresh is ~8 days old (or on a 401), refresh tokens are
// single-use, and a refresh performed INSIDE a guest rotates the token family
// — the host's copy then dies with "refresh token was already used" (forced
// re-login). 7 days leaves a day of margin below codex's own threshold.
export const CODEX_AUTH_MAX_AGE_DAYS = 7

interface CodexAuth {
	tokens?: { refresh_token?: string }
	last_refresh?: string
	OPENAI_API_KEY?: string
}

// Pure preflight: throw (with the operator's next action) unless this
// auth.json is safe to stage into guests. An api-key-mode auth.json (no
// tokens, an OPENAI_API_KEY field) carries no refresh semantics, so no
// staleness guard applies.
export function validateCodexAuth(content: string, now: Date, where: string): void {
	let auth: CodexAuth
	try {
		auth = JSON.parse(content) as CodexAuth
	} catch {
		throw new Error(`${where} is not valid JSON — run \`codex login\` on the host`)
	}
	if (auth.tokens?.refresh_token) {
		const ageDays = (now.getTime() - Date.parse(auth.last_refresh ?? "")) / 86_400_000
		if (!(ageDays <= CODEX_AUTH_MAX_AGE_DAYS)) {
			throw new Error(
				`${where} tokens were last refreshed over ${CODEX_AUTH_MAX_AGE_DAYS} days ago (codex refreshes at ~8 days, and a refresh inside a guest would rotate the single-use refresh token and poison this host's session) — run any codex command on the host to refresh, then retry`,
			)
		}
		return
	}
	if (auth.OPENAI_API_KEY) return
	throw new Error(
		`${where} has neither ChatGPT tokens nor an API key — run \`codex login\` on the host`,
	)
}

interface CodexStreamLine {
	type?: string
	item?: {
		type?: string
		text?: string
		command?: string
		changes?: Array<{ path?: string }>
	}
	usage?: { input_tokens?: number; output_tokens?: number }
	error?: { message?: string }
	message?: string
}

const clip = (s: string, max = 60): string => (s.length > max ? `${s.slice(0, max)}…` : s)

// One human-readable label per --json stdout line; null for lines that aren't
// codex's JSON (dropped from the progress stream). Event taxonomy:
// thread.started / turn.started / turn.completed / turn.failed /
// item.{started,updated,completed} (item.type = agent_message,
// command_execution, file_change, reasoning, web_search, todo_list,
// mcp_tool_call, error) / error.
export function describeCodexStreamLine(line: string): string | null {
	let obj: CodexStreamLine
	try {
		obj = JSON.parse(line) as CodexStreamLine
	} catch {
		return null
	}
	const item = obj.item
	const label = (obj.type ?? "") + (item?.type ? `:${item.type}` : "")
	let detail = ""
	if (item?.type === "agent_message") {
		detail = ` ${item.text?.length ?? 0} chars`
	} else if (item?.type === "command_execution" && item.command) {
		detail = ` ${clip(item.command)}`
	} else if (item?.type === "file_change") {
		detail = ` ${(item.changes ?? []).length} file(s)`
	} else if (obj.type === "turn.completed") {
		detail = ` ${obj.usage?.input_tokens ?? 0} in, ${obj.usage?.output_tokens ?? 0} out tokens`
	} else if (obj.type === "turn.failed") {
		detail = ` ${clip(obj.error?.message ?? "")}`
	} else if (obj.type === "error") {
		detail = ` ${clip(obj.message ?? "")}`
	}
	return `[${label}]${detail}`
}
