import { logger } from "@llmgateway/logger";

const discordWebhookUrl = process.env.DISCORD_NOTIFICATION_URL;

interface DiscordEmbed {
	title: string;
	description?: string;
	color?: number;
	fields?: Array<{
		name: string;
		value: string;
		inline?: boolean;
	}>;
	timestamp?: string;
}

interface DiscordWebhookPayload {
	content?: string;
	embeds?: DiscordEmbed[];
}

async function sendDiscordNotification(
	payload: DiscordWebhookPayload,
): Promise<void> {
	if (!discordWebhookUrl) {
		logger.debug(
			"DISCORD_NOTIFICATION_URL not configured, skipping notification",
		);
		return;
	}

	try {
		const response = await fetch(discordWebhookUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		});

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(
				`Discord webhook error: ${response.status} - ${errorText}`,
			);
		}

		logger.debug("Discord notification sent successfully");
	} catch (error) {
		logger.error(
			"Failed to send Discord notification",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

export async function notifyUserSignup(
	email: string,
	name: string | null | undefined,
	authMethod?: string,
): Promise<void> {
	const displayName = name ?? "Unknown";
	const method = authMethod ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "New User Signup",
				color: 0x22c55e, // Green
				fields: [
					{
						name: "Email",
						value: email,
						inline: true,
					},
					{
						name: "Name",
						value: displayName,
						inline: true,
					},
					{
						name: "Auth Method",
						value: method,
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyCreditsPurchased(
	email: string,
	name: string | null | undefined,
	creditAmount: number,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Credits Purchased",
				color: 0x3b82f6, // Blue
				fields: [
					{
						name: "Email",
						value: email,
						inline: true,
					},
					{
						name: "Name",
						value: displayName,
						inline: true,
					},
					{
						name: "Credits",
						value: `$${creditAmount.toFixed(2)}`,
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}
