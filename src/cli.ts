import { join, resolve } from "node:path"
import { Command } from "commander"
import { runChecks } from "./check.ts"

function parsePositiveInt(flag: string) {
	return (v: string): number => {
		const n = Number.parseInt(v, 10)
		if (!Number.isInteger(n) || n < 1)
			throw new Error(`${flag} must be a positive integer, got "${v}"`)
		return n
	}
}

const program = new Command()
	.name("doublecheck")
	.description(
		"Run self-authored LLM code-inspectors (.agents/checks/*.md) against a project, one sandboxed agent per check",
	)

program
	.command("check")
	.option("--project <dir>", "project to inspect", process.cwd())
	.option("--model <model>", "model for the inspector agents", "haiku")
	.option("--parallel <n>", "max concurrent checks", parsePositiveInt("--parallel"), 4)
	.option("--output <dir>", "reports root (default: $PROJECT/.doublecheck)")
	.option(
		"--check <name>",
		"run only this check (repeatable)",
		(v: string, prev: string[]) => [...prev, v],
		[] as string[],
	)
	.action(async (opts) => {
		const project = resolve(opts.project)
		const ok = await runChecks({
			project,
			model: opts.model,
			parallel: opts.parallel,
			output: opts.output ? resolve(opts.output) : join(project, ".doublecheck"),
			only: opts.check,
		})
		if (!ok) process.exitCode = 1
	})

program.parseAsync().catch((e: unknown) => {
	console.error(e instanceof Error ? e.message : String(e))
	process.exit(1)
})
