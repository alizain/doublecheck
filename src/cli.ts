#!/usr/bin/env node
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { Command } from "commander"
import { runChecks } from "./check.ts"
import { runMine } from "./mine.ts"

function parsePositiveInt(flag: string) {
	return (v: string): number => {
		const n = Number.parseInt(v, 10)
		if (!Number.isInteger(n) || n < 1)
			throw new Error(`${flag} must be a positive integer, got "${v}"`)
		return n
	}
}

const collect = (v: string, prev: string[]): string[] => [...prev, v]

const program = new Command()
	.name("doublecheck")
	.description(
		"Run self-authored LLM code-inspectors (checks) against a target tree, one sandboxed agent per check",
	)

program
	.command("check")
	.option("--target <dir>", "tree under inspection, mounted read-only", process.cwd())
	.option(
		"--checks-dir <dir>",
		"checks directory (repeatable; default: $TARGET/.agents/checks)",
		collect,
		[] as string[],
	)
	.option(
		"--context <file>",
		"run-context file spliced into every inspector's prompt (intent, nuances, sanctioned exceptions, scope)",
	)
	.option(
		"--agent <name>",
		"agent CLI that runs the inspectors: claude or codex",
		"claude",
	)
	.option(
		"--model <model>",
		"model for the inspector agents (default per agent: claude haiku, codex gpt-5.6-sol)",
	)
	.option("--parallel <n>", "max concurrent checks", parsePositiveInt("--parallel"), 4)
	.option("--output <dir>", "reports root (default: $TARGET/.doublecheck)")
	.option("--check <name>", "run only this check (repeatable)", collect, [] as string[])
	.option(
		"--save-jsonl",
		"persist each inspector's raw stream-json beside its report (audit trail)",
	)
	.action(async (opts) => {
		const target = resolve(opts.target)
		const checksDirs: string[] =
			opts.checksDir.length > 0
				? opts.checksDir.map((d: string) => resolve(d))
				: [join(target, ".agents", "checks")]
		const ok = await runChecks({
			target,
			checksDirs,
			contextFile: opts.context ? resolve(opts.context) : null,
			agent: opts.agent,
			model: opts.model,
			parallel: opts.parallel,
			output: opts.output ? resolve(opts.output) : join(target, ".doublecheck"),
			only: opts.check,
			saveJsonl: !!opts.saveJsonl,
		})
		if (!ok) process.exitCode = 1
	})

program
	.command("mine")
	.option(
		"--projects <dir>",
		"Claude Code transcripts root",
		join(homedir(), ".claude", "projects"),
	)
	.option(
		"--catalog <dir>",
		"observation catalog root",
		join(homedir(), ".doublecheck", "catalog"),
	)
	.option("--agent <name>", "agent CLI that runs the miners: claude or codex", "claude")
	.option(
		"--model <model>",
		"model for the mining agents (default per agent: claude opus, codex gpt-5.6-sol — a bad-model mine pollutes a durable asset)",
	)
	.option("--parallel <n>", "max concurrent miners", parsePositiveInt("--parallel"), 4)
	.option(
		"--min-turns <n>",
		"min genuine human turns for a real conversation",
		parsePositiveInt("--min-turns"),
		2,
	)
	.option("--limit <n>", "mine at most N pending units", parsePositiveInt("--limit"))
	.option("--dry-run", "list what would be mined without booting anything")
	.action(async (opts) => {
		const ok = await runMine({
			projects: resolve(opts.projects),
			catalog: resolve(opts.catalog),
			agent: opts.agent,
			model: opts.model,
			parallel: opts.parallel,
			minTurns: opts.minTurns,
			limit: opts.limit,
			dryRun: !!opts.dryRun,
		})
		if (!ok) process.exitCode = 1
	})

program.parseAsync().catch((e: unknown) => {
	console.error(e instanceof Error ? e.message : String(e))
	process.exit(1)
})
