import { afterEach, describe, expect, it, vi } from "vitest";

import { RealtimeConnectError } from "./errors.js";
import { runRealtimePreflight } from "./preflight.js";

vi.mock("@/lib/api-key-usage-limits.js", () => ({
	assertApiKeyWithinUsageLimits: vi.fn(),
	assertMemberProjectAccess: vi.fn(async () => {}),
	assertMemberWithinBudget: vi.fn(async () => {}),
}));

vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(async () => null),
	findOrganizationById: vi.fn(async () => null),
	findProjectById: vi.fn(async () => null),
	findProviderKey: vi.fn(async () => undefined),
}));

vi.mock("@/lib/compliance.js", () => ({
	assertProviderCompliant: vi.fn(async () => {}),
}));

vi.mock("@/lib/iam.js", () => ({
	validateRequestModelAccess: vi.fn(async () => ({ allowed: true })),
	throwIamException: vi.fn(),
}));

afterEach(() => {
	delete process.env.REALTIME_GEMINI_DISABLED;
});

async function expectConnectError(
	requestedModel: string | undefined,
	intent?: string,
): Promise<RealtimeConnectError> {
	try {
		await runRealtimePreflight({
			token: "llmgtwy_test",
			requestedModel,
			intent,
		});
	} catch (error) {
		return error as RealtimeConnectError;
	}
	throw new Error("preflight unexpectedly succeeded");
}

describe("runRealtimePreflight Gemini kill switch", () => {
	it("returns a 503 for Gemini models when disabled", async () => {
		process.env.REALTIME_GEMINI_DISABLED = "true";
		const error = await expectConnectError(
			"gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(error).toBeInstanceOf(RealtimeConnectError);
		expect(error.status).toBe(503);
		expect(error.code).toBe("realtime_gemini_disabled");
	});

	it("leaves other providers unaffected when Gemini is disabled", async () => {
		process.env.REALTIME_GEMINI_DISABLED = "true";
		// The OpenAI path proceeds past the kill switch and fails later, on the
		// unknown API key.
		const error = await expectConnectError("gpt-realtime-2.1-mini");
		expect(error.code).toBe("invalid_api_key");
	});

	it("admits Gemini models when the switch is unset", async () => {
		const error = await expectConnectError(
			"gemini-2.5-flash-native-audio-preview-12-2025",
		);
		expect(error.code).toBe("invalid_api_key");
	});
});

describe("runRealtimePreflight transcription sessions", () => {
	// Model resolution runs before the API key lookup, so a resolved model
	// fails on the unknown key while an unresolved one fails on the model.
	it("resolves a transcription model with intent=transcription", async () => {
		const error = await expectConnectError(
			"gpt-live-transcribe",
			"transcription",
		);
		expect(error.code).toBe("invalid_api_key");
	});

	it("resolves a transcription model without the intent parameter", async () => {
		const error = await expectConnectError("gpt-live-transcribe");
		expect(error.code).toBe("invalid_api_key");
	});

	it("rejects a speech model under intent=transcription", async () => {
		const error = await expectConnectError("gpt-realtime", "transcription");
		expect(error.status).toBe(400);
		expect(error.code).toBe("model_not_found");
	});

	it("requires a model for transcription sessions", async () => {
		const error = await expectConnectError(undefined, "transcription");
		expect(error.code).toBe("missing_model");
		expect(error.message).toContain("intent=transcription");
	});

	it("rejects unknown intents", async () => {
		const error = await expectConnectError("gpt-realtime", "chat");
		expect(error.status).toBe(400);
		expect(error.code).toBe("invalid_intent");
	});
});
