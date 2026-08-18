import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyChatSupportEscalation } from "./discord.js";

const webhookUrl = "https://discord.test/support-webhook";
const adminConversationUrl =
	"https://admin.example.test/chat-support-logs?chat=conversation-123";

describe("chat support Discord notifications", () => {
	const fetchMock = vi.fn(
		async (_url: string | URL | Request, _init?: RequestInit) =>
			new Response(null, { status: 204 }),
	);

	beforeEach(() => {
		process.env.DISCORD_SUPPORT_NOTIFICATION_URL = webhookUrl;
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		delete process.env.DISCORD_SUPPORT_NOTIFICATION_URL;
		vi.unstubAllGlobals();
		fetchMock.mockClear();
	});

	it("links directly to the support ticket", async () => {
		await notifyChatSupportEscalation({
			conversationId: "conversation-123",
			adminConversationUrl,
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		expect(fetchMock).toHaveBeenCalledWith(
			webhookUrl,
			expect.objectContaining({
				body: expect.any(String),
			}),
		);

		const request = fetchMock.mock.calls[0][1];
		const payload = JSON.parse(String(request?.body)) as {
			embeds: Array<{
				url?: string;
				fields?: Array<{ name: string; value: string }>;
			}>;
		};

		expect(payload.embeds[0].url).toBe(adminConversationUrl);
		expect(payload.embeds[0].fields).toContainEqual({
			name: "Admin dashboard",
			value: `[View support ticket](${adminConversationUrl})`,
			inline: false,
		});
	});
});
