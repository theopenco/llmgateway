import { afterEach, describe, expect, test, vi } from "vitest";

import { POST } from "./route";

vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => ({ value: "test-token" }) }),
}));
vi.mock("@/lib/getUser", () => ({
	getUser: async () => ({ id: "fixture-user" }),
}));

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

function mockGateway(response: Response) {
	vi.stubEnv("REALTIME_BACKEND_URL", "http://localhost:4301");
	return vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
}

function mintSession(body: Record<string, unknown>) {
	return POST(
		new Request("http://localhost/api/realtime/session", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
}

function mintedSession(upstream: ReturnType<typeof mockGateway>): unknown {
	expect(upstream).toHaveBeenCalledOnce();
	const [url, init] = upstream.mock.calls[0];
	expect(url).toBe("http://localhost:4301/v1/realtime/client_secrets");
	return (JSON.parse(String(init?.body)) as { session: unknown }).session;
}

const secret = () => Response.json({ value: "test-secret", expires_at: 1 });

describe("POST /api/realtime/session", () => {
	test("pins the requested ASR model for a token-billed realtime model", async () => {
		const upstream = mockGateway(secret());
		const response = await mintSession({
			model: "gpt-realtime-2.1",
			transcriptionModel: "openai/gpt-4o-transcribe",
		});
		expect(response.status).toBe(200);
		expect(mintedSession(upstream)).toEqual({
			type: "realtime",
			model: "gpt-realtime-2.1",
			audio: {
				input: { transcription: { model: "openai/gpt-4o-transcribe" } },
			},
		});
	});

	test.each([
		"grok-voice-3-0",
		"gemini-2.5-flash-native-audio-preview-12-2025",
	])("mints %s with no ASR model", async (model) => {
		const upstream = mockGateway(secret());
		const response = await mintSession({ model });
		expect(response.status).toBe(200);
		expect(mintedSession(upstream)).toEqual({ type: "realtime", model });
	});

	test("rejects a token-billed realtime model without an ASR model", async () => {
		const upstream = mockGateway(secret());
		const response = await mintSession({ model: "gpt-realtime-2.1" });
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Choose a transcription model for this realtime model.",
		});
		expect(upstream).not.toHaveBeenCalled();
	});

	test.each([42, null])(
		"rejects a non-string transcription model: %s",
		async (transcriptionModel) => {
			const upstream = mockGateway(secret());
			const response = await mintSession({
				model: "gpt-realtime-2.1",
				transcriptionModel,
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({
				error: "Invalid transcription model",
			});
			expect(upstream).not.toHaveBeenCalled();
		},
	);

	test("relays the gateway's error message and status", async () => {
		mockGateway(
			Response.json(
				{
					error: {
						message: "Transcription model is not allowed for this key.",
						code: "transcription_model_not_allowed",
					},
				},
				{ status: 403 },
			),
		);
		const response = await mintSession({
			model: "gpt-realtime-2.1",
			transcriptionModel: "openai/gpt-4o-transcribe",
		});
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "Transcription model is not allowed for this key.",
		});
	});
});
