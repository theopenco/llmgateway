import { defaultAudioSettings, generateSpeech } from "@/api/audio";
import { gatewayClient } from "@/api/gateway";
import { blobBase64 } from "@/lib/blob";

jest.mock("@/api/gateway", () => ({ gatewayClient: jest.fn() }));
jest.mock("@/lib/blob", () => ({ blobBase64: jest.fn() }));

const post = jest.fn();
beforeEach(() => {
	jest.resetAllMocks();
	jest
		.mocked(gatewayClient)
		.mockResolvedValue({ POST: post } as unknown as Awaited<
			ReturnType<typeof gatewayClient>
		>);
	post.mockResolvedValue({
		data: { size: 4 },
		response: new Response(null, { headers: { "Content-Type": "audio/wav" } }),
	});
	jest.mocked(blobBase64).mockResolvedValue("YXVkaW8=");
});

test("uses the pinned speech model and reads its binary response", async () => {
	const model = "openai/gpt-4o-mini-tts";
	const result = await generateSpeech("project", model, " Hello ", {
		...defaultAudioSettings(model),
		format: "wav",
		voice: "coral",
		instructions: " Cheerfully ",
		speed: 1.25,
	});
	expect(gatewayClient).toHaveBeenCalledWith("project", model);
	expect(post).toHaveBeenCalledWith("/v1/audio/speech", {
		parseAs: "blob",
		body: {
			model,
			input: "Hello",
			voice: "coral",
			response_format: "wav",
			instructions: "Cheerfully",
			speed: 1.25,
		},
	});
	expect(result.audio).toEqual({ base64: "YXVkaW8=", mediaType: "audio/wav" });
});

test("uses each comparison model's supported voice, format, and controls", async () => {
	await generateSpeech("project", "gemini-2.5-flash-preview-tts", "Hello", {
		...defaultAudioSettings("tts-1"),
		speed: 2,
	});
	expect(post).toHaveBeenCalledWith("/v1/audio/speech", {
		parseAs: "blob",
		body: {
			model: "gemini-2.5-flash-preview-tts",
			input: "Hello",
			voice: "Kore",
			response_format: "wav",
		},
	});
});

test("rejects empty audio without creating a playable result", async () => {
	post.mockResolvedValue({ data: { size: 0 }, response: new Response() });
	const result = await generateSpeech(
		"project",
		"tts-1",
		"Hello",
		defaultAudioSettings("tts-1"),
	);
	expect(result.audio).toBeNull();
	expect(result.error).toMatch(/no audio/);
	expect(blobBase64).not.toHaveBeenCalled();
});

test("keeps successful comparison audio when another model fails", async () => {
	post
		.mockResolvedValueOnce({ data: { size: 4 }, response: new Response() })
		.mockRejectedValueOnce(new Error("Provider unavailable"));
	const results = await Promise.all(
		["tts-1", "tts-1-hd"].map((model) =>
			generateSpeech("project", model, "Hello", defaultAudioSettings(model)),
		),
	);
	expect(results[0].audio).not.toBeNull();
	expect(results[1]).toMatchObject({
		audio: null,
		error: "Provider unavailable",
	});
});
