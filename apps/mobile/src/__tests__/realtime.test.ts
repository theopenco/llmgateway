import { gatewayClient } from "@/api/gateway";
import { mintTranscriptionSession } from "@/api/realtime";

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
