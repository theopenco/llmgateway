import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { realtimeClientSecretsRoute } from "./client-secrets-route.js";

const mocks = vi.hoisted(() => ({
	createClientSecret: vi.fn(),
	runRealtimePreflight: vi.fn(),
}));

vi.mock("@/lib/extract-api-token.js", () => ({
	extractApiToken: () => "test-token",
}));

vi.mock("./client-secrets.js", () => ({
	clampClientSecretTtl: () => 60,
	createClientSecret: mocks.createClientSecret,
}));

vi.mock("./preflight.js", () => ({
	runRealtimePreflight: mocks.runRealtimePreflight,
}));

describe("realtime client secrets route", () => {
	const previousRealtimeEnabled = process.env.REALTIME_ENABLED;

	beforeEach(() => {
		process.env.REALTIME_ENABLED = "true";
		mocks.createClientSecret.mockResolvedValue({
			value: "ek_test",
			expiresAt: 123,
		});
		mocks.runRealtimePreflight.mockResolvedValue({
			match: {
				modelId: "gpt-realtime-2.1-mini",
				mapping: { providerId: "openai" },
			},
			allowedTranscriptionModelIds: [],
			project: { organizationId: "org_test" },
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
		if (previousRealtimeEnabled === undefined) {
			delete process.env.REALTIME_ENABLED;
		} else {
			process.env.REALTIME_ENABLED = previousRealtimeEnabled;
		}
	});

	it("stores and returns the canonical model", async () => {
		const response = await realtimeClientSecretsRoute.request(
			"/client_secrets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					session: { type: "realtime", model: "gpt-realtime-mini" },
				}),
			},
		);

		expect(response.status).toBe(200);
		expect(mocks.createClientSecret).toHaveBeenCalledWith(
			expect.objectContaining({ model: "openai/gpt-realtime-2.1-mini" }),
		);
		expect((await response.json()).session.model).toBe(
			"openai/gpt-realtime-2.1-mini",
		);
	});
});
