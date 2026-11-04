import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = fileURLToPath(new URL("../.next/server/", import.meta.url));
const files = (await readdir(serverRoot, { recursive: true })).filter((file) =>
	file.endsWith(".js"),
);
const sizes = await Promise.all(
	files.map(async (file) => (await stat(join(serverRoot, file))).size),
);
const bytes = sizes.reduce((sum, size) => sum + size, 0);
const budget = 40 * 1024 * 1024;

console.log(`Docs server JavaScript: ${(bytes / 1024 / 1024).toFixed(1)} MiB`);
if (bytes > budget) {
	throw new Error(
		"Docs server JavaScript exceeds 40 MiB. Check for duplicated MDX chunks before increasing the budget.",
	);
}
