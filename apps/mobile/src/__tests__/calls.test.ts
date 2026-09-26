import { callEntries, saveCall } from "@/api/calls";
import { client } from "@/api/client";
import { emptyCallUsage } from "@/lib/call-transcript";

import type { PendingCall } from "@/api/calls";

jest.mock("@/api/client", () => ({
	client: { POST: jest.fn(), PATCH: jest.fn() },
}));
const pending: PendingCall = {
	organizationId: "organization",
	state: {
		status: "idle",
		selection: { model: "openai/voice", protocol: "openai", voice: "alloy" },
		transcript: [
			{
				id: "seed-0",
				role: "user",
				text: "Earlier",
				status: "final",
				timestamp: 1,
			},
			{
				id: "new",
				role: "assistant",
				text: "New reply",
				status: "final",
				timestamp: 2,
				audio: { base64: "audio", mediaType: "audio/wav" },
			},
			{ id: "empty", role: "user", text: "", status: "partial", timestamp: 3 },
		],
		usage: { ...emptyCallUsage(), responses: 1, totalTokens: 9 },
		elapsed: 12,
		error: null,
		muted: false,
		inputLevel: 0,
		outputLevel: 0,
		userSpeaking: false,
		assistantSpeaking: false,
		audioLimited: false,
	},
};
beforeEach(() => jest.resetAllMocks());
test("creates a workspace call with only spoken entries and no wire IDs", async () => {
	jest.mocked(client.POST).mockResolvedValue({
		data: { item: { id: "saved" } },
		response: new Response(),
	} as Awaited<ReturnType<typeof client.POST>>);
	expect(await saveCall(pending)).toBe("saved");
	expect(client.POST).toHaveBeenCalledWith("/playground/realtime-history", {
		body: {
			organizationId: "organization",
			title: "Earlier",
			model: "openai/voice",
			voice: "alloy",
			durationSeconds: 12,
			transcript: callEntries(pending.state),
			usage: pending.state.usage,
		},
	});
	expect(callEntries(pending.state)).toHaveLength(2);
	expect(callEntries(pending.state)[0]).not.toHaveProperty("id");
});
test("continues a call by appending only the new turns and session usage", async () => {
	jest.mocked(client.PATCH).mockResolvedValue({
		data: { item: { id: "saved" } },
		response: new Response(),
	} as Awaited<ReturnType<typeof client.PATCH>>);
	await saveCall({ ...pending, resumeId: "saved" });
	expect(client.POST).not.toHaveBeenCalled();
	expect(client.PATCH).toHaveBeenCalledWith(
		"/playground/realtime-history/{id}",
		{
			params: { path: { id: "saved" } },
			body: {
				appendTranscript: [
					{
						role: "assistant",
						text: "New reply",
						status: "final",
						timestamp: 2,
						audio: { base64: "audio", mediaType: "audio/wav" },
					},
				],
				addDurationSeconds: 12,
				addUsage: pending.state.usage,
			},
		},
	);
});
