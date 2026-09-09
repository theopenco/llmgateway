import { describe, expect, it } from "vitest";

import { createLogEntry } from "./create-log-entry.js";
import { validateSource } from "./validate-source.js";

import type { CreateLogEntryOptions } from "./create-log-entry.js";
import type { GatewayApiKey } from "@/lib/cached-queries.js";

/**
 * `usedMode` decides whether the organization is charged for a request: the
 * worker deducts the full cost for `credits` and only the data-storage cost for
 * `api-keys` (apps/worker/src/worker.ts). Getting it wrong for a
 * platform-managed credential means LLM Gateway pays the provider and bills
 * nobody, so the mapping is pinned here.
 */
describe("createLogEntry", () => {
	const project = {
		id: "project-id",
		organizationId: "org-id",
	} as unknown as CreateLogEntryOptions["project"];

	const apiKey = {
		id: "api-key-id",
		projectId: "project-id",
	} as unknown as GatewayApiKey;

	function entry(overrides: Partial<CreateLogEntryOptions> = {}) {
		return createLogEntry({
			requestId: "request-id",
			project,
			apiKey,
			usedModel: "openai/gpt-4o-mini",
			usedProvider: "openai",
			requestedModel: "gpt-4o-mini",
			messages: [],
			customHeaders: {},
			debugMode: false,
			...overrides,
		});
	}

	it.each([
		"codex",
		"claude.com/claude-code",
		"open-code",
		"lounge.llmgateway.io",
		"chat.llmgateway.io",
		"docs-ask-ai",
		"support-chat",
		"onboarding",
		"llmgateway.io/playground",
		"chatbox",
		"continue.dev",
		"bolt.new",
		"v0.dev",
		"lovable.dev",
	])("preserves the recognized source %s", (source) => {
		expect(entry({ source }).source).toBe(source);
	});

	it("normalizes raw sources used by client-error logging", () => {
		expect(entry({ source: "https://www.lounge.llmgateway.io" }).source).toBe(
			"lounge.llmgateway.io",
		);
		expect(entry({ source: "invalid_source?request=123" }).source).toBe(
			"unknown",
		);
		expect(entry({ source: "a".repeat(10_000) }).source).toBe("unknown");
		expect(entry().source).toBeNull();
	});

	it("bounds distinct sources from validated headers and referers", () => {
		const sources = new Set(
			Array.from(
				{ length: 100 },
				(_, index) =>
					entry({ source: validateSource(`app-${index}.example.com`) }).source,
			),
		);
		expect([...sources]).toEqual(["unknown"]);
		expect(
			entry({ source: validateSource(undefined, "https://www.example.com") })
				.source,
		).toBe("unknown");
		expect(entry({ source: "custom-claw-1" }).source).toBe("openclaw");
		expect(entry({ source: "custom-claw-2" }).source).toBe("openclaw");
	});

	it("bills as credits when the platform's own credential served the request", () => {
		// Covers both platform paths: an `LLM_*` env var and a managed
		// provider-key row. Neither is the organization's key, so neither sets
		// organizationProviderKeyId.
		expect(entry().usedMode).toBe("credits");
	});

	it("bills as api-keys only for the organization's own provider key", () => {
		expect(entry({ organizationProviderKeyId: "byok-key-id" }).usedMode).toBe(
			"api-keys",
		);
	});

	it("treats an undefined organization key as credits", () => {
		expect(entry({ organizationProviderKeyId: undefined }).usedMode).toBe(
			"credits",
		);
	});

	it("bills as credits through the positional overload with no org key", () => {
		const positional = createLogEntry(
			"request-id",
			project,
			apiKey,
			undefined,
			"openai/gpt-4o-mini",
			undefined,
			"openai",
			"gpt-4o-mini",
			undefined,
			[],
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{},
			false,
			undefined,
		);
		expect(positional.usedMode).toBe("credits");
	});
});
