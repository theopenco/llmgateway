import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notifyAirsideFiling } from "@/utils/discord.js";

import { logger } from "@llmgateway/logger";
import { postDiscordWebhook } from "@llmgateway/shared";

vi.mock("@llmgateway/shared", () => ({ postDiscordWebhook: vi.fn() }));
vi.mock("@llmgateway/logger", () => ({
	logger: { debug: vi.fn(), error: vi.fn() },
}));

describe("Airside filing notifications", () => {
	beforeEach(() => {
		vi.stubEnv(
			"DISCORD_AIRSIDE_NOTIFICATION_URL",
			"https://discord.test/airside",
		);
		vi.stubEnv("ADMIN_URL", "https://admin.example.com");
		vi.mocked(postDiscordWebhook).mockResolvedValue(undefined);
	});
	afterEach(() => {
		vi.resetAllMocks();
		vi.unstubAllEnvs();
	});
	it.each([
		"claim",
		"branding",
		"provider-key",
		"initial",
		"update",
		"metadata",
		"routing",
		"relist",
	] as const)(
		"sends %s to its dedicated channel with a bounded timeout",
		async (kind) => {
			await notifyAirsideFiling({
				kind,
				id: "filing-test",
				providerId: "test-carrier",
				modelName: "test-model",
			});
			expect(postDiscordWebhook).toHaveBeenCalledExactlyOnceWith(
				"https://discord.test/airside",
				{
					embeds: [
						expect.objectContaining({
							title: expect.stringContaining("Airside filing:"),
							url: "https://admin.example.com/airside-filings",
							fields: expect.arrayContaining([
								{ name: "Carrier", value: "test-carrier", inline: true },
								{ name: "Model", value: "test-model", inline: true },
								{ name: "Filing", value: "filing-test" },
							]),
						}),
					],
				},
				{ timeoutMs: 5000 },
			);
		},
	);
	it("does not fall back to the general notification channel", async () => {
		vi.stubEnv("DISCORD_AIRSIDE_NOTIFICATION_URL", "");
		vi.stubEnv("DISCORD_NOTIFICATION_URL", "https://discord.test/general");
		await notifyAirsideFiling({
			kind: "claim",
			id: "claim-test",
			providerId: "test-carrier",
		});
		expect(postDiscordWebhook).not.toHaveBeenCalled();
	});
	it("logs delivery failures without failing the filing", async () => {
		vi.mocked(postDiscordWebhook).mockRejectedValueOnce(
			new Error("Discord unavailable"),
		);
		await expect(
			notifyAirsideFiling({
				kind: "initial",
				id: "filing-test",
				providerId: "test-carrier",
			}),
		).resolves.toBeUndefined();
		expect(logger.error).toHaveBeenCalledOnce();
	});
	it.each(["", "invalid-url"])(
		"does not reject a committed filing when ADMIN_URL is %j",
		async (adminUrl) => {
			vi.stubEnv("ADMIN_URL", adminUrl);
			await expect(
				notifyAirsideFiling({
					kind: "claim",
					id: "claim-test",
					providerId: "test-carrier",
				}),
			).resolves.toBeUndefined();
		},
	);
	it("bounds user-controlled embed fields", async () => {
		await notifyAirsideFiling({
			kind: "initial",
			id: "filing-test",
			providerId: "test-carrier",
			modelName: "a".repeat(2000),
		});
		const payload = vi.mocked(postDiscordWebhook).mock.calls[0][1];
		expect(
			payload.embeds?.[0].fields?.find((field) => field.name === "Model")
				?.value,
		).toHaveLength(1024);
	});
});
