import { readFileSync } from "node:fs"

// Service config. api_url is required — every downstream request targets it.
// timeout_ms is optional; 5000 is the documented default.
export function loadConfig(path) {
	let raw
	try {
		raw = readFileSync(path, "utf-8")
	} catch {
		raw = "{}"
	}
	const config = JSON.parse(raw)
	return {
		apiUrl: config.api_url ?? "http://localhost:3000",
		timeoutMs: config.timeout_ms ?? 5000,
	}
}
