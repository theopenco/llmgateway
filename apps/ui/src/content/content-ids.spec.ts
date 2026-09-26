import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const contentDir = join(import.meta.dirname, ".");

const collections = readdirSync(contentDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

function frontmatterValue(source: string, field: string) {
	const frontmatter = source.split(/^---$/m)[1] ?? "";
	const match = frontmatter.match(new RegExp(`^${field}:\\s*(.+)$`, "m"));
	return match?.[1].trim().replace(/^"(.*)"$/, "$1");
}

function duplicates(values: { file: string; value: string }[]) {
	const seen = new Map<string, string>();
	const conflicts: string[] = [];
	for (const { file, value } of values) {
		const previous = seen.get(value);
		if (previous) {
			conflicts.push(`${value}: ${previous} and ${file}`);
		} else {
			seen.set(value, file);
		}
	}
	return conflicts;
}

describe.each(collections)("%s content", (collection) => {
	const files = readdirSync(join(contentDir, collection)).filter((file) =>
		file.endsWith(".md"),
	);
	const entries = files.map((file) => ({
		file,
		source: readFileSync(join(contentDir, collection, file), "utf8"),
	}));

	it("has an id and slug on every entry", () => {
		expect(entries.length).toBeGreaterThan(0);
		for (const { file, source } of entries) {
			expect(frontmatterValue(source, "id"), `${file} id`).toBeTruthy();
			expect(frontmatterValue(source, "slug"), `${file} slug`).toBeTruthy();
		}
	});

	it("has unique ids", () => {
		expect(
			duplicates(
				entries.map(({ file, source }) => ({
					file,
					value: frontmatterValue(source, "id") ?? "",
				})),
			),
		).toEqual([]);
	});

	it("has unique slugs", () => {
		expect(
			duplicates(
				entries.map(({ file, source }) => ({
					file,
					value: frontmatterValue(source, "slug") ?? "",
				})),
			),
		).toEqual([]);
	});
});
