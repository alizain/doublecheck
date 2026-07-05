import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

// A check is a plain markdown file in $PROJECT/.agents/checks — no
// frontmatter, no schema. The body is the inspector's instructions; the name
// is the filename minus .md.
export interface Check {
	name: string
	body: string
}

// `only` (from repeated --check flags) filters; naming a check that doesn't
// exist is an error, not an empty run.
export function discoverChecks(project: string, only: string[]): Check[] {
	const dir = join(project, ".agents", "checks")
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		throw new Error(`no checks directory at ${dir}`)
	}
	const all = entries
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => ({
			name: f.slice(0, -".md".length),
			body: readFileSync(join(dir, f), "utf-8"),
		}))
	if (all.length === 0) throw new Error(`no checks (*.md) in ${dir}`)
	if (only.length === 0) return all
	const byName = new Map(all.map((c) => [c.name, c]))
	return only.map((name) => {
		const check = byName.get(name)
		if (!check) {
			const have = all.map((c) => c.name).join(", ")
			throw new Error(`no check named "${name}" in ${dir} (have: ${have})`)
		}
		return check
	})
}
