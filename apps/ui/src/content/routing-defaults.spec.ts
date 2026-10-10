import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { interpolateRoutingDefaults } from "@llmgateway/shared/routing-defaults";

// Collections that resolve %routing.<path>% tokens (see content-collections.ts).
const INTERPOLATED_COLLECTIONS = ["blog", "guides", "migrations", "use-cases"];

const files = INTERPOLATED_COLLECTIONS.flatMap((collection) =>
	(readdirSync(join(__dirname, collection), { recursive: true }) as string[])
		.filter((file) => file.endsWith(".md"))
		.map((file) => join(__dirname, collection, file)),
).filter((file) => readFileSync(file, "utf8").includes("%routing."));

describe("routing default tokens in content", () => {
	it("finds content that uses routing tokens", () => {
		expect(files.length).toBeGreaterThan(0);
	});

	it.each(files)("resolves every token in %s", (file: string) => {
		const out = interpolateRoutingDefaults(readFileSync(file, "utf8"));
		expect(out).not.toContain("%routing.");
	});
});
