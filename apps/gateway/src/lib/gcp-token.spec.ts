import { generateKeyPairSync, randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getGcpAccessToken, getVertexAnthropicProjectId } from "./gcp-token.js";

import type * as CacheModule from "@llmgateway/cache";

const redisGetMock = vi.hoisted(() => vi.fn());
const redisSetMock = vi.hoisted(() => vi.fn());

vi.mock("@llmgateway/cache", async (importOriginal) => ({
	...(await importOriginal<typeof CacheModule>()),
	redisClient: {
		get: redisGetMock,
		set: redisSetMock,
	},
}));

describe("Vertex Anthropic env credential", () => {
	beforeEach(() => {
		redisGetMock.mockReset().mockResolvedValue(null);
		redisSetMock.mockReset().mockResolvedValue("OK");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("exchanges at Google's token endpoint whatever token_uri says", async () => {
		const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
		vi.stubEnv(
			"LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON",
			JSON.stringify({
				client_email: `${randomUUID()}@example.iam.gserviceaccount.com`,
				private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
				token_uri: "https://token.example.com/token",
				project_id: "env-project",
			}),
		);
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ access_token: "env-token" }));

		expect(getVertexAnthropicProjectId()).toBe("env-project");
		await expect(getGcpAccessToken()).resolves.toBe("env-token");
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			"https://oauth2.googleapis.com/token",
		);
	});

	it("returns null when no credential is configured", async () => {
		vi.stubEnv("LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON", "");
		await expect(getGcpAccessToken()).resolves.toBeNull();
	});
});
