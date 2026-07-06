# Codex as a second agent CLI — design

**Date:** 2026-07-06
**Status:** approved (co-designed in conversation; this doc records the decisions and the verified facts they rest on)

## The goal

Run checks (and eventually mines) with OpenAI's Codex CLI as the inspector
agent, selected per run, under the exact same contract the claude adapter
already honors: prompt staged as `prompt.txt`, report read back as
`report.md`, microVM as the safety boundary. Everything claude-specific in
the codebase becomes one implementation of a named interface; everything
already CLI-agnostic (runner, contract semantics, report collection) stays
untouched.

## Verified facts this design rests on

Two evidence classes: official docs / codex source (researched 2026-07-05
against https://developers.openai.com/codex and github.com/openai/codex,
npm @openai/codex 0.142.5), and live spikes on this machine (host
codex-cli 0.139.0, isolated `CODEX_HOME`, real ChatGPT-plan auth).

- **Headless invocation** (spiked live, end-to-end): `codex exec --json
  --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox
  --ephemeral -m <model> - < prompt.txt` — prompt from stdin via `-`, JSONL
  events on stdout, report file written to cwd, exit 0. `--ephemeral` writes
  no session rollout files (verified).
- **`--json` event taxonomy** (docs + live capture agree): top-level `type`
  is `thread.started`, `turn.started`, `turn.completed` (carries `usage`
  token counts), `turn.failed`, `item.started` / `item.updated` /
  `item.completed`, `error`. Item events carry `item.type` ∈
  `agent_message` (field `text`), `command_execution` (`command`,
  `aggregated_output`, `exit_code`, `status`), `file_change` (`changes[]`),
  `reasoning`, `web_search`, `todo_list`, `mcp_tool_call`, `error`.
- **Staged `auth.json` is the documented container pattern** (OpenAI CI/CD
  docs show `docker cp ~/.codex/auth.json` into the container). A
  ChatGPT-plan `auth.json` carries `tokens.{id_token, access_token,
  refresh_token, account_id}` plus `last_refresh` (RFC3339).
- **Refresh semantics** (codex source): codex refreshes when `last_refresh`
  is older than ~8 days (`TOKEN_REFRESH_INTERVAL = 8`) or on a 401, and
  rewrites `auth.json` in place. Refresh tokens are **single-use** — a
  refresh performed inside a guest rotates the token family and the host's
  copy dies with "refresh token was already used" (forced re-login). OpenAI
  explicitly warns against sharing one `auth.json` across concurrent jobs.
- **Endpoints by auth mode**: ChatGPT-plan inference goes to
  `chatgpt.com/backend-api/codex`; token refresh to
  `auth.openai.com/oauth/token`. (API-key auth would go to
  `api.openai.com`, and the env var `codex exec` honors is `CODEX_API_KEY`,
  **not** `OPENAI_API_KEY` — recorded because everyone gets it wrong; not
  used by this design.)
- **Ambient state, and its kill switches** (spiked live, before/after): with
  a default home, codex at boot clones the `github@openai-curated` plugin
  from the marketplace (bringing skills like `yeet` that push to git),
  fetches an apps cache, and auto-reads `AGENTS.md` from home / repo root /
  cwd. `features.plugins = false` + `features.apps = false` stop the
  fetches (verified: no clone, no cache dir), `project_doc_max_bytes = 0`
  short-circuits all AGENTS.md loading (verified in source). Side effect:
  trivial-task input tokens fell 75k → 11.5k.
- **Parity notes**: `multi_agent` is a stable, default-on feature (codex's
  analog of claude's Task tool). Web search is a **server-side** Responses
  API tool — config `web_search = "live"` (the `--search` flag is TUI-only;
  under a full-access sandbox the `cached` default auto-upgrades to `live`
  anyway) — so it works regardless of guest egress. `apply_patch` accepts
  absolute paths; writability is the sandbox's decision, and we bypass the
  inner sandbox. There is no claude-style `--tools` allowlist; the toolset
  is feature-flag-driven, and the staged config covers the flags that
  matter.
- **First-run trust**: the bypass flag suppresses the onboarding/trust
  prompt, and explicitly setting both `approval_policy` and `sandbox_mode`
  in config.toml is the second documented suppression path (open issue
  #14547 reports leaks; we do both).
- **Packaging**: `npm install -g @openai/codex` installs a fully static
  musl binary via per-platform optionalDependencies (no postinstall network
  fetch, no glibc/libssl requirement — runs on any Linux including the
  arm64 microVM). Cost: ~250 MB in the image. Never pass
  `--omit=optional`/`--no-optional` or the binary is silently skipped.
- **Models** (docs, mid-2026): `gpt-5.5` is the recommended default;
  `gpt-5.4`, `gpt-5.4-mini` current; `gpt-5.2` and `gpt-5.3-codex`
  deprecated for ChatGPT sign-in. Reasoning effort is the config key
  `model_reasoning_effort`.

## Ontology

Three concepts, three names, kept bijective:

| Concept | Name |
|---|---|
| doublecheck's mechanics (sandbox, mounts, parallelism, reports) | **harness** (as the README already uses it) |
| the agent CLI brand and its adapter code (claude, codex) | **agent CLI** — flag `--agent`, interface `AgentCli` |
| one running inspector instance | **agent** (as `runAgent`/`AgentSpec`/`AgentOutcome` already use it) |

The interface is named `AgentCli`, not `Harness`, because the README
reserves "harness" for doublecheck itself and the operator-facing flag is
`--agent`; the flag, the registry keys, and the interface must name the
same concept.

## Decisions

### CLI surface

- `check` gains `--agent <name>` (default `claude`), validated against the
  registry; an unknown name is a hard error listing the known names.
  `mine` gains it in the mine slice (see Slices).
- `--model`'s default becomes agent-dependent, applied only when `--model`
  is absent: claude → `haiku` (check) / `opus` (mine), unchanged; codex →
  `gpt-5.5` for both workflows. Codex guests always run
  `model_reasoning_effort = "xhigh"` via the staged config (operator
  decision; plan billing is flat-rate, so there is no haiku-style cost
  gradient to encode in a cheaper default).

### The `AgentCli` interface (`src/agent-cli.ts`)

```ts
export interface AgentCli {
	name: string
	defaultModel: { check: string; mine: string }
	// The exact phrase the report contract uses to tell this agent how to
	// create a file, e.g. "with the Write tool" for claude; null when the
	// prompt should just say "create <path>".
	writeToolPhrase: string | null
	// Host-side preflight: returns the secret material staged into guests,
	// or throws with an actionable message. Runs once per invocation,
	// before any guest boots.
	credentials(): string
	agent(opts: { credentials: string; model: string; workdir: string }): AgentSpec
	describeStreamLine(line: string): string | null
}
```

A two-entry registry maps `--agent` values to implementations.
`progressSink(label, describe)` moves out of `claude.ts` into
`agent-cli.ts` — it was never claude-specific; it takes the describe
function instead of importing claude's. `check.ts`/`mine.ts` swap their
direct `claudeAgent` / `progressSink` / token-preflight calls for the
resolved `AgentCli`'s members. `runner.ts` is untouched until the mine
slice.

### The codex adapter (`src/codex.ts`)

`codexAgent(opts) → AgentSpec` plus `describeCodexStreamLine`, mirroring
`claude.ts` in shape:

- **command**: `codex exec --json --skip-git-repo-check
  --dangerously-bypass-approvals-and-sandbox --ephemeral -m <model> - <
  prompt.txt`. The bypass flag is OpenAI's documented container guidance —
  the microVM is the safety boundary, exactly claude's
  `--dangerously-skip-permissions` rationale; `--ephemeral` is the analog
  of `--no-session-persistence`; `--skip-git-repo-check` because the
  scratch cwd is not a git repo.
- **env**: `HOME=/root` (CODEX_HOME defaults to `$HOME/.codex`),
  `GIT_OPTIONAL_LOCKS=0`. No token env var — auth is a staged file. No
  `IS_SANDBOX` (a claude-ism).
- **files** (mode 0600; the codex analog of the minimal `.claude.json`,
  deliberately NOT a copy of the host's config, which carries MCP API
  keys, personality, plugins, and a trust table):
  - `/root/.codex/auth.json` — byte-for-byte copy of the host's, read at
    invocation start by `credentials()`.
  - `/root/.codex/config.toml` — minimal and guest-only:

    ```toml
    approval_policy = "never"
    sandbox_mode = "danger-full-access"
    model_reasoning_effort = "xhigh"
    web_search = "live"
    project_doc_max_bytes = 0
    cli_auth_credentials_store = "file"

    [features]
    plugins = false
    apps = false
    ```

    `approval_policy`/`sandbox_mode` double the bypass flag
    (belt-and-suspenders for the trust prompt, issue #14547);
    `project_doc_max_bytes = 0` keeps the piped prompt the agent's only
    input — no ambient AGENTS.md; the feature flags stop the boot-time
    marketplace clone and apps fetch, which under restricted egress (the
    future mine slice) would hang and under any egress inject tools the
    contract never sanctioned.
- **`describeCodexStreamLine`**: same contract as claude's — one
  human-readable label per stdout JSONL line, null for non-JSON. Labels
  from the verified taxonomy: `agent_message` → char count,
  `command_execution` → truncated command, `turn.completed` → token usage.
  Test fixtures are the live-captured stream lines from the 2026-07-05
  spike, not hand-written guesses.

### Contract change: the write-tool phrase

`contract.ts` is agent-agnostic except that `firstActionLine` and
`reportContract` say "with the Write tool" — a claude tool name, and
hard-won wording (haiku's report compliance went ~50% → 3/3 with it).
The phrase becomes a parameter supplied from `AgentCli.writeToolPhrase`:
claude passes `"with the Write tool"` and its composed prompt stays
**byte-identical** (pinned by the existing contract tests); codex passes
`null` and the sentence reads "create `<path>` (a title line is enough)".
Naming a tool codex doesn't have would invite the agent to distrust its
brief.

### Codex credentials preflight

Runs on the host once per invocation, before any guest boots. Hard fail
throughout — a degraded-auth run wastes guest boots and risks the host
session:

- `~/.codex/auth.json` missing or unparseable → error: run `codex login`
  on the host.
- `tokens.refresh_token` present (the ChatGPT-plan case): `last_refresh`
  missing or older than **7 days** → error: run any codex command on the
  host to refresh, then retry. Rationale: at ~8 days a guest would attempt
  the refresh itself, and a guest-side refresh rotates the single-use
  refresh token, poisoning the host session. The 7-day threshold leaves a
  day of margin.
- No `tokens` but an `OPENAI_API_KEY` field (an api-key-mode `auth.json`):
  stage as-is; no refresh semantics, no staleness guard.
- Guests get a fresh copy each run and **nothing is ever written back** —
  token rotation inside a guest is the failure we prevent, not sync we
  need.

Residual, accepted risk: a mid-run 401 can still trigger a guest-side
refresh. It is rare, the staleness guard makes it rarer, and the host's
`auth.json` is in daily interactive use (stays fresh). Documented in the
README's codex section rather than engineered around.

### Guest image

`Dockerfile.guest` adds `RUN npm install -g @openai/codex` — same
unpinned, rebuild-to-upgrade policy as the claude CLI. One image serves
both agent CLIs (+~250 MB). If codex's fast release cadence ever breaks
the `--json` schema, the blast radius is mislabeled progress lines — the
report contract does not depend on the event stream. `build-guest-image.sh`
unchanged.

### Egress (mine slice, designed now, built later)

`runner.ts`'s `network: "all" | "anthropic-only"` generalizes to a
harness-supplied domain-suffix list: claude miners get
`["anthropic.com"]` (behavior-identical to today), codex miners
`["chatgpt.com", "openai.com"]` (inference at
`chatgpt.com/backend-api/codex`; `auth.openai.com` for the refresh path a
401 can force — suffix `openai.com` covers it). Check runs keep `"all"`.
Not built until the mine slice: `check` never uses restricted egress, so
the enum is not in slice 1–3's way.

## Non-changes

- `runner.ts`, `catalog.ts`, `transcript.ts`: untouched in the check
  slices.
- The report contract's semantics (absolute path, create-first, ledger
  discipline, "every line is read") — unchanged for both agents; only the
  write-tool phrase varies.
- Claude's composed prompt, command, env, and staged files: byte-identical
  before and after the refactor. Existing tests pin this.
- Tests never call a real agent CLI (standing rule): `codex.test.ts`
  mirrors `claude.test.ts` (command flags, env, staged-file contents,
  stream-line labeling over captured real lines); integration tests keep
  their fake agent. Live validation is ad-hoc operator runs.

## Slices

Each independently shippable, in order; no separate implementation plan
(this doc is the spec, execution is iterative):

1. **`src/codex.ts` + `tests/codex.test.ts`** — the adapter and its
   describer, pure, nothing wired.
2. **`src/agent-cli.ts` + `--agent` on `check`** — interface, registry,
   contract-phrase parametrization, codex preflight, per-agent model
   defaults, `check.ts` wired through the interface; claude path proven
   byte-identical by tests. (`--agent codex` exists but cannot complete a
   run until slice 3 bakes the binary into the guest image — a guest boot
   would fail loudly at `codex: command not found`.)
3. **Guest image + live smoke** — bake codex into the image, operator runs
   `doublecheck check --target fixtures/planted --agent codex`
   end-to-end. Settles the two things only a real run can: codex-in-microVM
   behavior (expected boring — static musl binary) and gpt-5.5's report
   contract compliance (measured for haiku, assumed-not-measured for
   codex until this run).
4. **`mine --agent codex`** (later) — egress generalization per above,
   `--agent` on mine, live mine smoke. Separate decision point: it sends
   Claude-transcript content to OpenAI, which the operator sanctioned
   designing for but not yet shipping.

## Amendment (same day): what shipped, where it refined the text above

All four slices shipped in one pass — including slice 4, originally marked
"later": the mine live-verification privacy question dissolved once the
smoke ran against a **synthetic** transcript (`--projects` pointed at a
staged fake), so no personal transcript content went to OpenAI. Operator
runs against real transcripts with `--agent codex` remain the operator's
call at invocation time; the README states the data flow plainly.

Refinements over the approved text, made during implementation and review:

- **Reasoning effort default revised to `high`** (operator decision, same
  day, after live runs): the config block below says `"xhigh"` as approved;
  what ships is `model_reasoning_effort = "high"`.

- **The model rides in the staged `config.toml` (`model = "…"`), not a
  `-m` flag.** Spiked live before the change: identical behavior. This
  removes the only operator-supplied value that was interpolated into the
  guest's bash command string; the command is now a fixed literal.
- **`AgentCli` gained `egressDomains: string[]`** (the interface block
  above predates slice 4); `runner.ts`'s network option is now
  `"all" | { onlyDomains: string[] }`, superseding the
  `"anthropic-only"` enum described in `2026-07-05-mine-design.md`.
- **`mine` validates `--agent` eagerly** (before the dry-run and
  nothing-pending short-circuits) but preflights credentials only when it
  will boot guests — a dry run must not require credentials.
- **Accepted asymmetry:** the mine prompt's investigation vocabulary
  ("Grep that turn's text…, then Read … with offset/limit") keeps claude's
  tool names unparametrized. The live codex mine handled the vocabulary
  fine (used `rg` and `sed` unprompted), and rewording would risk the
  measured claude phrasing for a cosmetic gain.

Live verification (2026-07-06, all exit 0): `check --target
fixtures/planted --agent codex --save-jsonl` found exactly the two planted
fallbacks, flagged neither legitimate default, produced the discipline
ledger, and left a valid 31-event stream file; `mine --agent codex` over a
synthetic transcript produced on-format observations under the
codex egress allowlist; real-guest integration tests cover both egress
shapes (world blocked, listed suffixes reachable); the host's `auth.json`
was never modified by any run. An adversarial review workflow (4 reviewers,
2 skeptics per finding) confirmed zero defects.

## Known unknowns, parked

- The exact serde spelling of api-key-mode `auth_mode` (`"apikey"` vs
  `"api_key"`) — irrelevant while preflight keys on field presence, not
  `auth_mode`.
- Whether server-side web search needs hosts beyond the inference endpoint
  under restricted egress — moot until the mine slice; checks run with
  `network: "all"`.
- Whether `spawn_agent` (multi_agent) tool depth/behavior matches Task in
  practice — observable in slice 3's `--save-jsonl` stream if a check
  exercises it.
