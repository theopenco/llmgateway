import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const workRoot =
	process.env.BENCH_HOME ?? join(homedir(), "agent-benchmark-work");

export const redactPaths = (text) =>
	text.replaceAll(workRoot, "$BENCH_HOME").replaceAll(homedir(), "~");

function redactDir(dir) {
	let changed = 0;
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			changed += redactDir(path);
			continue;
		}
		const text = readFileSync(path, "utf8");
		const redacted = redactPaths(text);
		if (redacted !== text) {
			writeFileSync(path, redacted);
			changed++;
		}
	}
	return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const resultsRoot = join(dirname(fileURLToPath(import.meta.url)), "results");
	for (const suite of process.argv.slice(2)) {
		console.log(
			`${suite}: ${redactDir(join(resultsRoot, suite))} files redacted`,
		);
	}
}
