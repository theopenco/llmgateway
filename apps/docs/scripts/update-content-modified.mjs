import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(docsRoot, "../..");
const contentPath = "apps/docs/content";
const contentRoot = join(repositoryRoot, contentPath);
const manifestPath = join(docsRoot, "lib/content-modified.json");
// Generated API reference pages are untracked; they share this key, dated by
// the gateway source they are generated from.
const apiReferenceKey = "(gateway)/(api)";

function git(...args) {
	return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
		cwd: repositoryRoot,
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
	}).trimEnd();
}

function hasFullHistory() {
	return (
		existsSync(join(repositoryRoot, ".git")) &&
		git("rev-parse", "--is-shallow-repository") === "false"
	);
}

// Newest commit date per tracked content file, from a single history walk.
function committedDates() {
	const dates = new Map();
	let date = "";
	const log = git("log", "--format=%x00%cI", "--name-only", "--", contentPath);
	for (const line of log.split("\n")) {
		if (line.startsWith("\0")) {
			date = line.slice(1);
		} else if (line && !dates.has(line)) {
			dates.set(line, date);
		}
	}
	return dates;
}

async function updateContentModified() {
	// Dates only come from Git history. Shallow checkouts and Docker builds keep
	// a manifest generated beforehand, or build without modification dates.
	if (!hasFullHistory()) {
		if (existsSync(manifestPath)) {
			console.log("No Git history; keeping existing modification dates.");
			return;
		}
		await writeFile(manifestPath, "{}\n");
		console.warn("No Git history; building docs without modification dates.");
		return;
	}

	const committed = committedDates();
	const dirty = new Set(
		git("status", "--porcelain", "--no-renames", "-uall", "--", contentPath)
			.split("\n")
			.filter(Boolean)
			.map((line) => line.slice(3)),
	);
	const files = (await readdir(contentRoot, { recursive: true }))
		.map((file) => file.replaceAll("\\", "/"))
		.filter((file) => file.endsWith(".mdx"))
		.sort();
	const manifest = {};
	for (const key of files) {
		const repositoryPath = `${contentPath}/${key}`;
		const lastModified = dirty.has(repositoryPath)
			? (await stat(join(contentRoot, key))).mtime
			: committed.get(repositoryPath);
		if (lastModified) {
			manifest[key] = new Date(lastModified).toISOString();
		}
	}
	const apiReferenceDate = git(
		"log",
		"-1",
		"--format=%cI",
		"--",
		"apps/gateway/src",
	);
	if (apiReferenceDate) {
		manifest[apiReferenceKey] = new Date(apiReferenceDate).toISOString();
	}
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(
		`Recorded modification dates for ${Object.keys(manifest).length} documentation entries.`,
	);
}

await updateContentModified();
