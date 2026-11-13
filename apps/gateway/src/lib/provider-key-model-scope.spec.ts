import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

// A BYOK key restricted to one model must never be sent upstream for another.
const RESTRICTED_TOKEN = ["restricted", "byok", "token"].join("-");
const PLATFORM_TOKEN = ["platform", "env", "token"].join("-");

const jsonRequests: [string, Record<string, unknown>][] = [
	[
		"/v1/chat/completions",
		{
			model: "openai/gpt-4o-mini",
			messages: [{ role: "user", content: "Key scope regression" }],
		},
	],
	[
		"/v1/messages",
		{
			model: "openai/gpt-4o-mini",
			max_tokens: 10,
			messages: [{ role: "user", content: "Key scope regression" }],
		},
	],
	[
		"/v1/responses",
		{
			model: "openai/gpt-4o-mini",
			input: "Key scope regression",
			store: false,
		},
	],
	[
		"/v1/embeddings",
		{ model: "openai/text-embedding-3-large", input: "Key scope regression" },
	],
	[
		"/v1/moderations",
		{ model: "omni-moderation-latest", input: "Key scope regression" },
	],
	[
		"/v1/audio/speech",
		{ model: "openai/tts-1", input: "Key scope regression", voice: "alloy" },
	],
];

function headerValues(input: RequestInfo | URL, init?: RequestInit): string {
	const values: string[] = [
		String(input instanceof Request ? input.url : input),
	];
	if (input instanceof Request) {
		input.headers.forEach((value) => values.push(value));
	}
	if (init?.headers) {
		new Headers(init.headers).forEach((value) => values.push(value));
	}
	return values.join("\n");
}

describe("provider key allowedModels on first selection", () => {
	const harness = createGatewayApiTestHarness();
	let upstreamCalls: string[] = [];

	beforeEach(async () => {
		vi.stubEnv("LLM_OPENAI_API_KEY", PLATFORM_TOKEN);
		vi.stubEnv("LLM_OPENAI_BASE_URL", harness.mockServerUrl);
		await db.insert(tables.apiKey).values({
			id: "scope-api-key",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			createdBy: "user-id",
			description: "Key scope regression",
		});
		await db.insert(tables.providerKey).values({
			id: "restricted-provider-key",
			...encryptProviderKeyForStorage(
				RESTRICTED_TOKEN,
				"restricted-provider-key",
				"org-id",
			),
			provider: "openai",
			organizationId: "org-id",
			baseUrl: harness.mockServerUrl,
			allowedModels: ["text-embedding-3-small"],
		});
		upstreamCalls = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			upstreamCalls.push(headerValues(input, init));
			return Response.json(
				{ error: { message: "Upstream rejected", type: "invalid_api_key" } },
				{ status: 401 },
			);
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
	});

	const sentRestrictedKey = () =>
		upstreamCalls.some((call) => call.includes(RESTRICTED_TOKEN));

	describe.each(["api-keys", "hybrid"] as const)("%s mode", (mode) => {
		beforeEach(async () => {
			await harness.setProjectMode(mode);
		});

		test.each(jsonRequests)(
			"%s does not send a key restricted to another model",
			async (requestPath, body) => {
				const response = await app.request(requestPath, {
					method: "POST",
					headers: {
						Authorization: "Bearer test-token",
						"Content-Type": "application/json",
						"x-no-fallback": "true",
					},
					body: JSON.stringify(body),
				});
				await response.text();
				expect(sentRestrictedKey()).toBe(false);
			},
		);

		test("the allowed model still selects the restricted key", async () => {
			const response = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "openai/text-embedding-3-small",
					input: "Key scope regression",
				}),
			});
			await response.text();
			expect(sentRestrictedKey()).toBe(true);
		});
	});

	test("api-keys mode rejects a disallowed model without an eligible key", async () => {
		await harness.setProjectMode("api-keys");
		const response = await app.request("/v1/embeddings", {
			method: "POST",
			headers: {
				Authorization: "Bearer test-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "openai/text-embedding-3-large",
				input: "Key scope regression",
			}),
		});
		expect(response.status, await response.text()).toBe(400);
		expect(upstreamCalls).toEqual([]);
	});
});

// Every organization-key lookup must pass a filter (normally
// buildByokKeyFilter) so allowedModels applies on the first attempt, not only
// on retries.
describe("findProviderKey call inventory", () => {
	const srcDir = path.resolve(import.meta.dirname, "..");

	function sourceFiles(dir: string): string[] {
		return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				return sourceFiles(full);
			}
			return entry.name.endsWith(".ts") &&
				!entry.name.endsWith(".spec.ts") &&
				!entry.name.endsWith(".e2e.ts")
				? [full]
				: [];
		});
	}

	test("every call passes a key filter", () => {
		const missing: string[] = [];
		for (const file of sourceFiles(srcDir)) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(/await findProviderKey\(/g)) {
				let depth = 1;
				let index = match.index + match[0].length;
				let args = 1;
				for (; index < source.length && depth > 0; index++) {
					const char = source[index];
					if (char === "(" || char === "{" || char === "[") {
						depth++;
					} else if (char === ")" || char === "}" || char === "]") {
						depth--;
					} else if (char === "," && depth === 1) {
						args++;
					}
				}
				// A trailing comma counts as an extra separator.
				const call = source.slice(match.index, index);
				const argCount = /,\s*\)$/.test(call) ? args - 1 : args;
				if (argCount < 5) {
					const line = source.slice(0, match.index).split("\n").length;
					missing.push(`${path.relative(srcDir, file)}:${line}`);
				}
			}
		}
		expect(missing).toEqual([]);
	});
});
