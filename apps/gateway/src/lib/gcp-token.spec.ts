import { generateKeyPairSync, randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { getGcpAccessToken, getVertexAnthropicProjectId } from "./gcp-token.js";

describe("Vertex Anthropic env credential", () => {
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
