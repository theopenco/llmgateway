import { gatewayClient } from "@/api/gateway";
import {
	findVoiceModel,
	mintTranscriptionSession,
	mintVoiceSession,
	voiceSelection,
} from "@/api/realtime";

import type { CatalogModel } from "@/components/ProviderOptions";

jest.mock("@/api/gateway", () => ({ gatewayClient: jest.fn() }));
const post = jest.fn();
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(gatewayClient)
		.mockResolvedValue({ POST: post } as unknown as Awaited<
			ReturnType<typeof gatewayClient>
		>);
});
test("mints a typed transcription session without putting credentials in the socket URL", async () => {
	post.mockResolvedValue({
		data: {
			value: "ephemeral",
			session: {
				type: "transcription",
				audio: { input: { transcription: { model: "openai/asr" } } },
			},
		},
	});
	const signal = new AbortController().signal;
	const session = await mintTranscriptionSession(
		"project",
		"openai/asr",
		signal,
	);
	expect(post).toHaveBeenCalledWith("/v1/realtime/client_secrets", {
		signal,
		body: {
			expires_after: { anchor: "created_at", seconds: 60 },
			session: {
				type: "transcription",
				audio: { input: { transcription: { model: "openai/asr" } } },
			},
		},
	});
	expect(session.url).toBe(
		"wss://api.llmgateway.io/v1/realtime?intent=transcription&model=openai%2Fasr",
	);
	expect(session.url).not.toContain(session.secret);
});
test("cancellation after key resolution prevents minting", async () => {
	const abort = new AbortController();
	abort.abort();
	await expect(
		mintTranscriptionSession("project", "asr", abort.signal),
	).rejects.toThrow();
	expect(post).not.toHaveBeenCalled();
});

const models = [
	{
		id: "voice",
		status: "active",
		mappings: [
			{ providerId: "openai", realtime: true, status: "active", region: "us" },
			{ providerId: "google-ai-studio", realtime: true, status: "active" },
		],
	},
	{
		id: "retired-asr",
		status: "active",
		mappings: [
			{
				providerId: "openai",
				realtimeTranscription: true,
				status: "active",
				deactivatedAt: "2020-01-01",
			},
		],
	},
	{
		id: "other-asr",
		status: "active",
		mappings: [
			{ providerId: "other", realtimeTranscription: true, status: "active" },
		],
	},
	{
		id: "asr",
		status: "active",
		mappings: [
			{
				providerId: "openai",
				realtimeTranscription: true,
				status: "active",
				region: "eu",
			},
		],
	},
] as CatalogModel[];
test("resolves saved bare models and provider pins with active same-provider transcription", () => {
	expect(voiceSelection("voice", "alloy", models)).toEqual({
		model: "openai/voice:us",
		voice: "alloy",
		protocol: "openai",
		transcriptionModel: "openai/asr:eu",
	});
	expect(voiceSelection("google-ai-studio/voice", "Puck", models)).toEqual({
		model: "google-ai-studio/voice",
		voice: "Puck",
		protocol: "gemini",
		transcriptionModel: undefined,
	});
	expect(findVoiceModel("other/voice", models)).toBeUndefined();
	expect(findVoiceModel("openai/voice:eu", models)).toBeUndefined();
	expect(() => voiceSelection("retired-asr", null, models)).toThrow(
		"available realtime model",
	);
});

test("mints voice and transcription settings together with a short-lived secret", async () => {
	post.mockResolvedValue({
		data: {
			value: "ephemeral",
			session: { type: "realtime", model: "openai/voice:us" },
		},
	});
	const signal = new AbortController().signal;
	const selection = voiceSelection("voice", "alloy", models);
	const minted = await mintVoiceSession("project", selection, signal);
	expect(post).toHaveBeenCalledWith("/v1/realtime/client_secrets", {
		signal,
		body: {
			expires_after: { anchor: "created_at", seconds: 60 },
			session: {
				type: "realtime",
				model: "openai/voice:us",
				audio: {
					input: { transcription: { model: "openai/asr:eu" } },
					output: { voice: "alloy" },
				},
			},
		},
	});
	expect(minted.url).toBe(
		"wss://api.llmgateway.io/v1/realtime?model=openai%2Fvoice%3Aus",
	);
	expect(minted.url).not.toContain(minted.secret);
});
