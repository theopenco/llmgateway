import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { remark } from "remark";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { describe, expect, it } from "vitest";

import {
	DEFAULT_ROUTING_STICKY,
	DEFAULT_ROUTING_WEIGHTS,
} from "@llmgateway/shared/routing-defaults";

import { remarkRoutingDefaults } from "./remark-routing-defaults";

const contentDir = join(__dirname, "..", "content");

function render(source: string) {
	return String(
		remark()
			.use(remarkMdx)
			.use(remarkGfm)
			.use(remarkRoutingDefaults)
			.processSync(source),
	);
}

const tokenizedPages = (
	readdirSync(contentDir, { recursive: true }) as string[]
)
	.filter((file) => file.endsWith(".mdx"))
	.filter((file) =>
		readFileSync(join(contentDir, file), "utf8").includes("%routing."),
	);

describe("remarkRoutingDefaults", () => {
	it("resolves tokens in text, code and JSX attributes", () => {
		const out = render(
			[
				"Throughput `%routing.weights.throughput%`, TTL %routing.sticky.ttlSeconds%",
				"",
				'<Callout title="Latency %routing.weights.latency%" />',
				"",
				"```json",
				'{ "ttlSeconds": %routing.sticky.ttlSeconds% }',
				"```",
			].join("\n"),
		);
		expect(out).toContain(`\`${DEFAULT_ROUTING_WEIGHTS.throughput}\``);
		const ttl = DEFAULT_ROUTING_STICKY.ttlSeconds;
		expect(out).toContain(`TTL ${ttl.toLocaleString("en-US")}`);
		expect(out).toContain(`Latency ${DEFAULT_ROUTING_WEIGHTS.latency}`);
		expect(out).toContain(`"ttlSeconds": ${ttl}`);
		expect(out).not.toContain("%routing.");
	});

	it("finds the pages that use routing tokens", () => {
		expect(tokenizedPages.length).toBeGreaterThan(0);
	});

	it.each(tokenizedPages)("resolves every token in %s", (file: string) => {
		const out = render(readFileSync(join(contentDir, file), "utf8"));
		expect(out).not.toContain("%routing.");
	});
});
