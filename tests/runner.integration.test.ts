// Boots real microsandbox guests with a FAKE agent (a bash one-liner standing
// in for claude — tests never call the real thing). Requires
// doublecheck-guest:latest in the msb cache: scripts/build-guest-image.sh.
import { existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { PROMPT_FILE } from "../src/contract.ts"
import type { AgentSpec } from "../src/runner.ts"
import { runCheck } from "../src/runner.ts"

const PROJECT = join(import.meta.dirname, "..")
const TIMEOUT = 120_000

function scratchWithPrompt(): string {
	const workdir = mkdtempSync(join(tmpdir(), "doublecheck-itest-"))
	writeFileSync(join(workdir, PROMPT_FILE), "fake prompt")
	return workdir
}

function fakeAgent(command: string, files: AgentSpec["files"] = []): AgentSpec {
	return { command, env: { HOME: "/root" }, files }
}

describe("runCheck against a real guest", () => {
	it(
		"delivers staged files, mounts the project ro, and returns the report",
		async () => {
			const workdir = scratchWithPrompt()
			const lines: string[] = []
			const outcome = await runCheck({
				project: PROJECT,
				workdir,
				// The fake agent proves each contract piece in one boot: reads the
				// ro project mount and a staged guest file into the report, fails
				// to write into the project, echoes progress on stdout.
				spec: fakeAgent(
					[
						`head -c 4 ${PROJECT}/package.json > report.md`,
						`cat /root/staged.txt >> report.md`,
						`touch ${PROJECT}/ITEST_SHOULD_NOT_EXIST 2>/dev/null || echo ro-denied`,
						`echo progress-line`,
					].join(" && "),
					[{ path: "/root/staged.txt", content: "staged-content" }],
				),
				onLine: (_kind, line) => lines.push(line),
			})
			expect(outcome).toEqual({ ok: true, report: '{\n\t"staged-content' })
			expect(lines).toContain("ro-denied")
			expect(lines).toContain("progress-line")
			expect(existsSync(join(PROJECT, "ITEST_SHOULD_NOT_EXIST"))).toBe(false)
		},
		TIMEOUT,
	)

	it(
		"reports failure with the partial report when the agent exits non-zero",
		async () => {
			const workdir = scratchWithPrompt()
			const outcome = await runCheck({
				project: PROJECT,
				workdir,
				spec: fakeAgent("echo partial > report.md && exit 3"),
				onLine: () => {},
			})
			expect(outcome).toEqual({
				ok: false,
				reason: "agent process exited 3",
				partialReport: "partial\n",
			})
		},
		TIMEOUT,
	)

	it(
		"reports failure when the agent exits 0 without writing a report",
		async () => {
			const workdir = scratchWithPrompt()
			const outcome = await runCheck({
				project: PROJECT,
				workdir,
				spec: fakeAgent("true"),
				onLine: () => {},
			})
			expect(outcome).toMatchObject({ ok: false, partialReport: null })
			expect(outcome.ok === false && outcome.reason).toMatch(/wrote no report\.md/)
		},
		TIMEOUT,
	)
})
