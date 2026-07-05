import { existsSync, readFileSync } from "node:fs"
import { basename, join } from "node:path"
import type { ExecEvent } from "microsandbox"
import { REPORT_FILE } from "./contract.ts"

// microsandbox exports its fluent builders as value-only consts; recover their
// instance types via a type-only import (erased at build) so the native module
// only loads behind the `await import` in runAgent.
type MountBuilder = InstanceType<typeof import("microsandbox").MountBuilder>
type PatchBuilder = InstanceType<typeof import("microsandbox").PatchBuilder>
type ExecOptionsBuilder = InstanceType<typeof import("microsandbox").ExecOptionsBuilder>
// The SDK types `.network(cb)` as `(b: any) => any`, and we call the JS-shim
// `.policy(...)`, absent from the native builder's types.
// biome-ignore lint/suspicious/noExplicitAny: SDK types this builder callback as any
type NetworkBuilder = any

// Locally built (Dockerfile.guest): node 24 slim + git/ripgrep/curl/wget + the
// claude CLI baked in. Side-loaded into the microsandbox cache by
// ./scripts/build-guest-image.sh — it exists nowhere else, hence pullPolicy
// "never": a cache miss means "run the build script", not "try Docker Hub".
const GUEST_IMAGE = "doublecheck-guest:latest"
const GUEST_MEMORY_MIB = 2048

// Staged into the guest before boot (e.g. claude's trust-accepted config).
export interface GuestFile {
	path: string
	content: string
}

// What it takes to run one agent in a booted guest: a bash command executed in
// the scratch cwd that must leave REPORT_FILE there, the env it needs, and
// files staged into the guest. Plain data — adapters produce it, this runner
// consumes it, tests fake it.
export interface AgentSpec {
	command: string
	env: Record<string, string>
	files: GuestFile[]
}

export type AgentOutcome =
	| { ok: true; report: string }
	| { ok: false; reason: string; partialReport: string | null }

export interface RunAgentOpts {
	// Host dir the agent inspects, bind-mounted READ-ONLY at its real host
	// path: the project for `check`, the transcripts corpus for `mine`.
	mount: string
	// Scratch dir with PROMPT_FILE already inside; bind-mounted rw as the guest
	// cwd at its identical host path, so the agent's report lands back on the host.
	workdir: string
	spec: AgentSpec
	// "all" for checks (inspectors may research); "anthropic-only" for miners:
	// the personal corpus is mounted, so the only reachable destination is the
	// API the agent already sends its context to. NetworkPolicy.none() is not
	// an option here — it kills DNS entirely and the adapter can't reach its
	// own model API (measured: claude retries ~180s then exits 1).
	network: "all" | "anthropic-only"
	onLine: (kind: "stdout" | "stderr", line: string) => void
}

// Boot a guest (ro mount + scratch rw as cwd), exec the agent command, stream
// its output line-by-line, read the report back off the scratch dir, tear
// down. Agent-level failures (exit ≠ 0, no report) return ok:false;
// harness-level failures (image missing, boot error) throw.
export async function runAgent(opts: RunAgentOpts): Promise<AgentOutcome> {
	const microsandbox = await import("microsandbox")
	const name = `doublecheck-${basename(opts.workdir)}`
	const policy =
		opts.network === "all"
			? microsandbox.NetworkPolicy.allowAll()
			: microsandbox.NetworkPolicy.builder()
					.defaultDeny()
					.egress((rb) => rb.allow((d) => d.domainSuffix("anthropic.com")))
					.build()
	let sandbox: InstanceType<typeof microsandbox.Sandbox> | null = null
	try {
		try {
			sandbox = await microsandbox.Sandbox.builder(name)
				.image(GUEST_IMAGE)
				.memory(GUEST_MEMORY_MIB)
				.pullPolicy("never")
				.replace()
				.workdir(opts.workdir)
				.envs(opts.spec.env)
				.volume(opts.mount, (mb: MountBuilder) => mb.bind(opts.mount).readonly())
				.volume(opts.workdir, (mb: MountBuilder) => mb.bind(opts.workdir))
				.patch((pb: PatchBuilder) => {
					let p = pb
					for (const f of opts.spec.files) {
						p = p.text(f.path, f.content, { mode: 0o600, replace: true })
					}
					return p
				})
				.network((nb: NetworkBuilder) => nb.policy(policy))
				.create()
		} catch (e) {
			if (String(e).includes("not cached")) {
				throw new Error(
					`guest image ${GUEST_IMAGE} is not in the microsandbox cache — run scripts/build-guest-image.sh (${String(e)})`,
				)
			}
			throw e
		}

		const handle = await sandbox.execStreamWith("bash", (e: ExecOptionsBuilder) =>
			e.args(["-c", opts.spec.command]),
		)

		const buf: Record<"stdout" | "stderr", string> = { stdout: "", stderr: "" }
		const emit = (kind: "stdout" | "stderr", data: Uint8Array) => {
			buf[kind] += Buffer.from(data).toString()
			const lines = buf[kind].split("\n")
			buf[kind] = lines.pop() ?? ""
			for (const line of lines) if (line.trim()) opts.onLine(kind, line)
		}
		let exitCode: number | null = null
		for (;;) {
			const ev: ExecEvent | null = await handle.recv()
			if (ev === null) break
			if (ev.kind === "stdout" || ev.kind === "stderr") emit(ev.kind, ev.data)
			else if (ev.kind === "exited") exitCode = ev.code
		}
		for (const kind of ["stdout", "stderr"] as const) {
			if (buf[kind].trim()) opts.onLine(kind, buf[kind])
		}

		const reportPath = join(opts.workdir, REPORT_FILE)
		const report = existsSync(reportPath) ? readFileSync(reportPath, "utf-8") : null
		if (exitCode !== 0) {
			return {
				ok: false,
				reason: `agent process exited ${exitCode}`,
				partialReport: report,
			}
		}
		if (report === null) {
			return {
				ok: false,
				reason: `agent exited 0 but wrote no ${REPORT_FILE} (work dir: ${opts.workdir})`,
				partialReport: null,
			}
		}
		return { ok: true, report }
	} finally {
		if (sandbox) {
			try {
				await sandbox.stop()
			} catch (e) {
				opts.onLine("stderr", `sandbox stop failed: ${String(e)}`)
			}
			try {
				await microsandbox.Sandbox.remove(name)
			} catch (e) {
				opts.onLine("stderr", `sandbox remove failed: ${String(e)}`)
			}
		}
	}
}
