import { readFile } from "node:fs/promises";

import { createOpenAPI } from "fumadocs-openapi/server";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";

import { openapi } from "./source";

afterEach(() => {
	vi.unstubAllEnvs();
});

beforeEach(() => {
	vi.clearAllMocks();
});

vi.mock("../.source/server", () => ({ docs: [], meta: [] }));
vi.mock("../openapi.json", () => ({
	default: {
		openapi: "3.0.0",
		info: { title: "Test API", version: "1.0.0" },
		servers: [{ url: "https://api.llmgateway.io" }],
		paths: {
			"/v1/chat/completions": {
				post: {
					responses: { "200": { $ref: "#/components/responses/Success" } },
				},
			},
			"/v1/audio/speech": {
				post: {
					responses: { "200": { $ref: "#/components/responses/Success" } },
				},
			},
		},
		components: { responses: { Success: { description: "Success" } } },
	},
}));
vi.mock("node:fs/promises", () => ({
	readFile: vi
		.fn()
		.mockRejectedValue(new Error("Runtime filesystem unavailable")),
}));

describe("bundled OpenAPI schema", () => {
	test("resolves generated API references without a runtime filesystem", async () => {
		const schema = await openapi.getSchema("./openapi.json");
		for (const path of ["/v1/chat/completions", "/v1/audio/speech"]) {
			expect(
				schema.dereferenced.paths?.[path]?.post?.responses?.["200"],
			).toEqual({
				description: "Success",
			});
		}
		expect(readFile).not.toHaveBeenCalled();
	});

	test("reproduces the file-based loader failure without a runtime filesystem", async () => {
		const fileBased = createOpenAPI({ input: ["./openapi.json"] });
		await expect(fileBased.getSchema("./openapi.json")).rejects.toThrow(
			"[OpenAPI] Failed to resolve input: ./openapi.json",
		);
	});
});
describe("API explorer destination", () => {
	test.each([
		["production", undefined, "https://api.llmgateway.io"],
		["development", undefined, "http://localhost:4001"],
		[
			"production",
			"https://gateway.example.com",
			"https://gateway.example.com",
		],
	])(
		"uses the configured %s gateway %s",
		async (mode: string, configured: string | undefined, expected: string) => {
			vi.stubEnv("NODE_ENV", mode);
			vi.stubEnv("GATEWAY_URL", configured);
			vi.resetModules();
			const { openapi: configuredOpenapi } = await import("./source");
			const schema = await configuredOpenapi.getSchema("./openapi.json");
			expect(schema.dereferenced.servers).toEqual([{ url: expected }]);
			expect(configuredOpenapi.options.proxyUrl).toBe("/api/proxy");
		},
	);
});
