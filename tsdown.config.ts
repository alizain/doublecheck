import { defineConfig } from "tsdown"

export default defineConfig({
	clean: true,
	entry: ["src/cli.ts"],
	format: ["esm"],
	minify: false,
	outDir: "dist",
	platform: "node",
	sourcemap: true,
})
