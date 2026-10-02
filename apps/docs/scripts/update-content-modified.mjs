import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(docsRoot, "../..");
const contentRoot = join(docsRoot, "content");
const manifestPath = join(docsRoot, "lib/content-modified.json");

function git(...args) {
	return execFileSync("git", args, {
		cwd: repositoryRoot,
		encoding: "utf8",
	}).trim();
}

async function updateContentModified() {
	const previous = JSON.parse(await readFile(manifestPath, "utf8"));
	const hasHistory =
		existsSync(join(repositoryRoot, ".git")) &&
		git("rev-parse", "--is-shallow-repository") === "false";
	const dirty = hasHistory
		? new Set(
				git("diff", "--name-only", "HEAD", "--", "apps/docs/content").split(
					"\n",
				),
			)
		: new Set();
	const files = (await readdir(contentRoot, { recursive: true }))
		.filter((file) => file.endsWith(".mdx"))
		.sort();
	const manifest = {};
	for (const file of files) {
		const fullPath = join(contentRoot, file);
		const key = file.replaceAll("\\", "/");
		const hash = createHash("sha256")
			.update(await readFile(fullPath))
			.digest("hex");
		if (previous[key]?.hash === hash) {
			manifest[key] = previous[key];
			continue;
		}
		if (!hasHistory) {
			throw new Error(
				`Missing trustworthy modification date for ${key}. Run pnpm --filter docs gen-docs in a checkout with full Git history and commit lib/content-modified.json.`,
			);
		}
		const repositoryPath = relative(repositoryRoot, fullPath).replaceAll(
			"\\",
			"/",
		);
		let lastModified = dirty.has(repositoryPath)
			? (await stat(fullPath)).mtime.toISOString()
			: git("log", "-1", "--format=%cI", "--", repositoryPath);
		if (!lastModified && key.startsWith("(gateway)/(api)/")) {
			lastModified = git("log", "-1", "--format=%cI", "--", "apps/gateway/src");
		}
		if (!lastModified) {
			lastModified = (await stat(fullPath)).mtime.toISOString();
		}
		manifest[key] = {
			hash,
			lastModified: new Date(lastModified).toISOString(),
		};
	}
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, "\t")}\n`);
	console.log(
		`Verified modification dates for ${files.length} documentation pages.`,
	);
}

await updateContentModified();
