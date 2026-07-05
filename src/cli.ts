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
	.option("--model <model>", "model for the mining agents", "opus")
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
