// Claude Code transcript (.jsonl) → the genuine human turns → a flat digest.
// Port of the June-2026 jq extraction, verified against the same corpus: a
// "genuine human turn" is type:user, not meta, not sidechain, text content
// only — which excludes the three things that are also type:user in the JSONL
// (tool_results, slash-command stdout wrappers, injected system-reminders).

// Per-turn char cap in the digest; the mining agent greps the source jsonl
// for full text when it needs context around a turn.
const TURN_CHAR_CAP = 2000

interface RawLine {
	type?: string
	isMeta?: boolean
	isSidechain?: boolean
	message?: { content?: unknown }
}

const NON_HUMAN_TEXT =
	/^\s*<command-name>|<local-command-stdout>|^\s*<local-command|^\s*<system-reminder>|Caveat: The messages below/

// Throws on an unparseable line — the caller decides what an unreadable
// transcript means for its run (mine counts and reports them, visibly).
export function humanTurns(jsonl: string): string[] {
	const turns: string[] = []
	for (const line of jsonl.split("\n")) {
		if (!line.trim()) continue
		const raw = JSON.parse(line) as RawLine
		if (raw.type !== "user" || raw.isMeta || raw.isSidechain) continue
		const content = raw.message?.content
		const text =
			typeof content === "string"
				? content
				: Array.isArray(content)
					? content
							.filter(
								(item): item is { type: "text"; text: string } =>
									typeof item === "object" &&
									item !== null &&
									(item as { type?: string }).type === "text" &&
									typeof (item as { text?: unknown }).text === "string",
							)
							.map((item) => item.text)
							.join("\n")
					: ""
		if (!text) continue
		if (NON_HUMAN_TEXT.test(text)) continue
		turns.push(text.replace(/[\n\r]+/g, " ⏎ ").slice(0, TURN_CHAR_CAP))
	}
	return turns
}

export interface DigestMeta {
	source: string
	project: string
	session: string
}

export function renderDigest(meta: DigestMeta, turns: string[]): string {
	const numbered = turns
		.map((t, i) => `${String(i + 1).padStart(3, " ")}  | ${t}`)
		.join("\n")
	return `# source:  ${meta.source}
# project: ${meta.project}
# session: ${meta.session}
# human_turns: ${turns.length}
# To understand WHY a terse turn or interruption happened, grep its text in the
# source file above and read the assistant turn(s) immediately before it.

${numbered}
`
}
