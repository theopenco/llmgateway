import { describe, expect, it } from "vitest";

import { buildProviderLockedRegions } from "./chat.js";

import type { InferSelectModel, tables } from "@llmgateway/db";

type ProviderKeyRow = InferSelectModel<typeof tables.providerKey>;

function key(
	id: string,
	provider: string,
	options: Record<string, string> | null,
): ProviderKeyRow {
	return {
		id,
		provider,
		options,
	} as unknown as ProviderKeyRow;
}

/**
 * The keys arrive in the order the gateway tries them, and
 * selectProviderKeyWithFailover runs the request on index 0 — so the region
 * lock has to come from index 0 too. It used to be assigned in a loop without
 * a guard, which meant the LAST key won: the request ran on one key's
 * credentials while being pinned to another key's region. Invisible while
 * order just meant "oldest first", wrong as soon as an organization reorders.
 */
describe("buildProviderLockedRegions", () => {
	it("takes the region from the first key, not the last", () => {
		const locked = buildProviderLockedRegions([
			key("primary", "aws-bedrock", { aws_bedrock_region: "eu-central-1" }),
			key("secondary", "aws-bedrock", { aws_bedrock_region: "us-east-1" }),
		]);

		expect(locked.get("aws-bedrock")).toBe("eu-central-1");
	});

	it("follows a reorder that promotes a different key", () => {
		// Same two keys, dragged the other way round.
		const locked = buildProviderLockedRegions([
			key("secondary", "aws-bedrock", { aws_bedrock_region: "us-east-1" }),
			key("primary", "aws-bedrock", { aws_bedrock_region: "eu-central-1" }),
		]);

		expect(locked.get("aws-bedrock")).toBe("us-east-1");
	});

	it("skips keys that pin no region and takes the first that does", () => {
		const locked = buildProviderLockedRegions([
			key("no-region", "aws-bedrock", null),
			key("has-region", "aws-bedrock", { aws_bedrock_region: "eu-west-1" }),
			key("later-region", "aws-bedrock", { aws_bedrock_region: "us-west-2" }),
		]);

		expect(locked.get("aws-bedrock")).toBe("eu-west-1");
	});

	it("locks each provider independently", () => {
		const locked = buildProviderLockedRegions([
			key("bedrock", "aws-bedrock", { aws_bedrock_region: "us-east-2" }),
			key("alibaba", "alibaba", { alibaba_region: "singapore" }),
		]);

		expect(locked.get("aws-bedrock")).toBe("us-east-2");
		expect(locked.get("alibaba")).toBe("singapore");
	});

	it("ignores providers that are not region-scoped", () => {
		const locked = buildProviderLockedRegions([
			key("openai", "openai", { aws_bedrock_region: "us-east-1" }),
		]);

		expect(locked.has("openai")).toBe(false);
	});
});
