import { readFileSync } from "node:fs";
import { build } from "esbuild";

const licenseFiles = [
	"LICENSE",
	"node_modules/@lezer/markdown/LICENSE",
	"node_modules/@lezer/common/LICENSE",
	"node_modules/@lezer/highlight/LICENSE",
];
const licenses = new Set(licenseFiles.map(path => readFileSync(path, "utf8").trim()));

await build({
	entryPoints: ["src/main.ts"],
	bundle: true,
	platform: "browser",
	target: "es2020",
	format: "cjs",
	external: ["obsidian"],
	outfile: "main.js",
	banner: { js: `/*!\n${[...licenses].join("\n\n")}\n*/` },
});
