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
	webhookUrl: string | undefined = discordWebhookUrl,
): Promise<void> {
	if (!webhookUrl) {
		logger.debug(
			"DISCORD_NOTIFICATION_URL not configured, skipping notification",
		);
		return;
	}

	try {
		const response = await fetch(webhookUrl, {
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

export async function notifyRefund(
	email: string,
	name: string | null | undefined,
	refundAmount: number,
	product: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Refund Processed",
				color: 0xf97316, // Orange
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
						name: "Product",
						value: product,
						inline: true,
					},
					{
						name: "Amount",
						value: `$${refundAmount.toFixed(2)}`,
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyDevPlanSubscribed(
	email: string,
	name: string | null | undefined,
	devPlan: string,
	cycle: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "DevPass Subscribed",
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
						name: "Plan",
						value: `${devPlan.toUpperCase()} (${cycle})`,
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyResetPassPurchased(
	email: string,
	name: string | null | undefined,
	devPlan: string,
	amount: number,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Reset Pass Purchased",
				color: 0x06b6d4, // Cyan
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
						name: "Tier",
						value: devPlan.toUpperCase(),
						inline: true,
					},
					{
						name: "Amount",
						value: `$${amount.toFixed(2)}`,
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyDevPlanCancelled(
	email: string,
	name: string | null | undefined,
	devPlan: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "DevPass Cancelled",
				color: 0xef4444, // Red
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
						name: "Plan",
						value: devPlan.toUpperCase(),
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyChatSupportEscalation(args: {
	name?: string;
	email?: string;
	conversationId: string;
	ipAddress?: string;
	lastMessage?: string;
}): Promise<void> {
	const { name, email, conversationId, ipAddress, lastMessage } = args;
	const truncatedMessage =
		lastMessage && lastMessage.length > 1000
			? `${lastMessage.slice(0, 1000)}…`
			: lastMessage;

	await sendDiscordNotification(
		{
			content: "🚨 A chat support conversation was escalated to a human.",
			embeds: [
				{
					title: "Chat Support Escalation",
					color: 0xf59e0b, // Amber
					fields: [
						{ name: "Name", value: name || "Not provided", inline: true },
						{ name: "Email", value: email || "Not provided", inline: true },
						{
							name: "Conversation ID",
							value: conversationId,
							inline: false,
						},
						...(ipAddress
							? [{ name: "IP Address", value: ipAddress, inline: true }]
							: []),
						...(truncatedMessage
							? [
									{
										name: "Last message",
										value: truncatedMessage,
										inline: false,
									},
								]
							: []),
					],
					timestamp: new Date().toISOString(),
				},
			],
		},
		process.env.DISCORD_SUPPORT_NOTIFICATION_URL ??
			process.env.DISCORD_NOTIFICATION_URL,
	);
}

export async function notifyEnterpriseContact(args: {
	name: string;
	email: string;
	country: string;
	size: string;
	deployment?: string | null;
	message: string;
	ipAddress?: string | null;
}): Promise<void> {
	const { name, email, country, size, deployment, message, ipAddress } = args;
	const truncatedMessage =
		message.length > 1000 ? `${message.slice(0, 1000)}…` : message;

	await sendDiscordNotification(
		{
			content: "📨 New enterprise contact request.",
			embeds: [
				{
					title: "Enterprise Contact Request",
					color: 0x2563eb, // Blue
					fields: [
						{ name: "Name", value: name, inline: true },
						{ name: "Email", value: email, inline: true },
						{ name: "Country", value: country, inline: true },
						{ name: "Company Size", value: size, inline: true },
						...(deployment
							? [{ name: "Deployment", value: deployment, inline: true }]
							: []),
						...(ipAddress
							? [{ name: "IP Address", value: ipAddress, inline: true }]
							: []),
						{ name: "Message", value: truncatedMessage, inline: false },
					],
					timestamp: new Date().toISOString(),
				},
			],
		},
		process.env.DISCORD_ENTERPRISE_NOTIFICATION_URL ??
			process.env.DISCORD_NOTIFICATION_URL,
	);
}

export async function notifyProviderContact(args: {
	providerName: string;
	email: string;
	url: string;
	termsUrl: string;
	privacyUrl: string;
	statusPageUrl?: string | null;
	country: string;
	compliance: string;
	dataRetentionDays: number;
	trainsOnData: boolean;
	ipAddress?: string | null;
}): Promise<void> {
	const {
		providerName,
		email,
		url,
		termsUrl,
		privacyUrl,
		statusPageUrl,
		country,
		compliance,
		dataRetentionDays,
		trainsOnData,
		ipAddress,
	} = args;

	await sendDiscordNotification(
		{
			content: "🧩 New provider listing request.",
			embeds: [
				{
					title: "Provider Listing Request",
					color: 0x8b5cf6, // Purple
					fields: [
						{ name: "Provider", value: providerName, inline: true },
						{ name: "Email", value: email, inline: true },
						{ name: "URL", value: url, inline: false },
						{ name: "Terms of Service", value: termsUrl, inline: false },
						{ name: "Privacy Policy", value: privacyUrl, inline: false },
						...(statusPageUrl
							? [{ name: "Status Page", value: statusPageUrl, inline: false }]
							: []),
						{ name: "HQ Country", value: country, inline: true },
						{
							name: "Data Retention",
							value: `${dataRetentionDays} days`,
							inline: true,
						},
						{
							name: "Trains on Data",
							value: trainsOnData ? "Yes" : "No",
							inline: true,
						},
						{ name: "Compliance", value: compliance, inline: false },
						...(ipAddress
							? [{ name: "IP Address", value: ipAddress, inline: true }]
							: []),
					],
					timestamp: new Date().toISOString(),
				},
			],
		},
		process.env.DISCORD_ENTERPRISE_NOTIFICATION_URL ??
			process.env.DISCORD_NOTIFICATION_URL,
	);
}

export async function notifyDevPlanRenewed(
	email: string,
	name: string | null | undefined,
	devPlan: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "DevPass Renewed",
				color: 0x8b5cf6, // Purple
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
						name: "Plan",
						value: devPlan.toUpperCase(),
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyChatPlanSubscribed(
	email: string,
	name: string | null | undefined,
	chatPlan: string,
	cycle: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Chat Plan Subscribed",
				color: 0x22c55e,
				fields: [
					{ name: "Email", value: email, inline: true },
					{ name: "Name", value: displayName, inline: true },
					{
						name: "Plan",
						value: `${chatPlan.toUpperCase()} (${cycle})`,
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyChatPlanCancelled(
	email: string,
	name: string | null | undefined,
	chatPlan: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Chat Plan Cancelled",
				color: 0xef4444,
				fields: [
					{ name: "Email", value: email, inline: true },
					{ name: "Name", value: displayName, inline: true },
					{ name: "Plan", value: chatPlan.toUpperCase(), inline: true },
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyChatPlanRenewed(
	email: string,
	name: string | null | undefined,
	chatPlan: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Chat Plan Renewed",
				color: 0x8b5cf6,
				fields: [
					{ name: "Email", value: email, inline: true },
					{ name: "Name", value: displayName, inline: true },
					{ name: "Plan", value: chatPlan.toUpperCase(), inline: true },
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyUserAccountDeleted(
	email: string,
	name: string | null | undefined,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Account Deleted",
				color: 0xef4444, // Red
				fields: [
					{ name: "Email", value: email, inline: true },
					{ name: "Name", value: displayName, inline: true },
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}
