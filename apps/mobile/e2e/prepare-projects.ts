import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const simulator = process.argv[2];
if (!simulator) {
	throw new Error("Pass the dedicated test simulator's device ID.");
}
const groups = execFileSync(
	"xcrun",
	[
		"simctl",
		"get_app_container",
		simulator,
		"com.apple.DocumentsApp",
		"groups",
	],
	{ encoding: "utf8" },
);
const container = groups
	.split("\n")
	.map((line) => line.split("\t"))
	.find(([name]) => name === "group.com.apple.FileProvider.LocalStorage")?.[1];
if (!container) {
	throw new Error("Open Files once on the test simulator, then try again.");
}
const storage = join(container, "File Provider Storage");
mkdirSync(storage, { recursive: true });
copyFileSync(
	new URL("./fixtures/lounge-knowledge.md", import.meta.url),
	join(storage, "lounge-knowledge.md"),
);
