import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	notifyChatSupportEscalation,
	notifyHighRiskAccount,
	notifyTopUpVelocityLimit,
} from "./discord.js";

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

describe("top-up velocity Discord notifications", () => {
	const topUpWebhookUrl = "https://discord.test/top-up-velocity-webhook";
	const fetchMock = vi.fn(
		async (_url: string | URL | Request, _init?: RequestInit) =>
			new Response(null, { status: 204 }),
	);

	beforeEach(() => {
		process.env.DISCORD_TOPUP_VELOCITY_NOTIFICATION_URL = topUpWebhookUrl;
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		delete process.env.DISCORD_TOPUP_VELOCITY_NOTIFICATION_URL;
		vi.unstubAllGlobals();
		fetchMock.mockClear();
	});

	it("uses the dedicated velocity-limit channel", async () => {
		await notifyTopUpVelocityLimit({
			email: "user@example.com",
			name: "Test User",
			organizationId: "organization-123",
			capUsd: 100,
			usedUsd: 95,
			attemptedUsd: 50,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			topUpWebhookUrl,
			expect.objectContaining({ body: expect.any(String) }),
		);

		const request = fetchMock.mock.calls[0][1];
		const payload = JSON.parse(String(request?.body)) as {
			embeds: Array<{ fields: Array<{ name: string; value: string }> }>;
		};

		expect(payload.embeds[0].fields).toEqual(
			expect.arrayContaining([
				{ name: "Organization", value: "organization-123", inline: false },
				{ name: "Limit", value: "$100.00", inline: true },
				{ name: "Used", value: "$95.00", inline: true },
				{ name: "Attempted", value: "$50.00", inline: true },
			]),
		);
		expect(request?.signal).toBeInstanceOf(AbortSignal);
	});

	it("uses the same channel for high-risk accounts", async () => {
		await notifyHighRiskAccount({
			email: "user@example.com",
			source: "signup",
			reason: "High abuse confidence",
			organizationIds: ["organization-123"],
		});

		expect(fetchMock).toHaveBeenCalledWith(
			topUpWebhookUrl,
			expect.objectContaining({ body: expect.any(String) }),
		);
	});
});
