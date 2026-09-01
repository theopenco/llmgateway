import { logger } from "@llmgateway/logger";

const discordWebhookUrl = process.env.DISCORD_NOTIFICATION_URL;
const DISCORD_ALERT_TIMEOUT_MS = 5_000;

interface DiscordEmbed {
	title: string;
	url?: string;
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
	timeoutMs?: number,
): Promise<void> {
	if (!webhookUrl) {
		logger.debug(
			"Discord notification webhook not configured, skipping notification",
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
			...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
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

function formatAmount(amount: number, currency: string): string {
	const normalized = currency.toUpperCase();
	return normalized === "USD"
		? `$${amount.toFixed(2)}`
		: `${amount.toFixed(2)} ${normalized}`;
}

export async function notifyUserSignup(
	email: string,
	name: string | null | undefined,
	authMethod?: string,
	countryCode?: string | null,
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
					{
						name: "Country",
						value: countryCode ?? "Unknown",
						inline: true,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

const creditTopUpSourceLabels = {
	stripe_checkout: "Stripe Checkout",
	payment_intent: "Saved card",
	auto_topup: "Auto top-up",
} as const;

export type CreditTopUpSource = keyof typeof creditTopUpSourceLabels;

export async function notifyCreditsPurchased(args: {
	email?: string | null;
	name?: string | null;
	/** Credits bought, excluding any bonus — the amount the customer paid for. */
	creditAmount: number;
	bonusAmount?: number;
	/** Total charged by Stripe, including platform and international card fees. */
	grossAmount: number;
	currency?: string;
	organizationId: string;
	organizationName?: string | null;
	source: CreditTopUpSource;
}): Promise<void> {
	const {
		email,
		name,
		creditAmount,
		bonusAmount = 0,
		grossAmount,
		currency = "USD",
		organizationId,
		organizationName,
		source,
	} = args;

	const fee = Math.max(0, grossAmount - creditAmount);

	await sendDiscordNotification({
		embeds: [
			{
				title: "Credits Purchased",
				color: 0x3b82f6, // Blue
				fields: [
					{
						name: "Email",
						value: email || "Unknown",
						inline: true,
					},
					{
						name: "Name",
						value: name ?? "Unknown",
						inline: true,
					},
					{
						name: "Credits",
						value: formatAmount(creditAmount, currency),
						inline: true,
					},
					...(bonusAmount > 0
						? [
								{
									name: "Bonus",
									value: formatAmount(bonusAmount, currency),
									inline: true,
								},
							]
						: []),
					{
						name: "Gross",
						value: formatAmount(grossAmount, currency),
						inline: true,
					},
					{
						name: "Fee",
						value: formatAmount(fee, currency),
						inline: true,
					},
					{
						name: "Source",
						value: creditTopUpSourceLabels[source],
						inline: true,
					},
					{
						name: "Organization",
						value: organizationName
							? `${organizationName} (${organizationId})`
							: organizationId,
						inline: false,
					},
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}

export async function notifyTopUpVelocityLimit(args: {
	email: string;
	name?: string | null;
	organizationId: string;
	capUsd: number;
	usedUsd: number;
	attemptedUsd: number;
}): Promise<void> {
	const { email, name, organizationId, capUsd, usedUsd, attemptedUsd } = args;

	await sendDiscordNotification(
		{
			content: "⚠️ A credit top-up was blocked by the velocity limit.",
			embeds: [
				{
					title: "Top-Up Velocity Limit Reached",
					color: 0xf59e0b, // Amber
					fields: [
						{ name: "Email", value: email, inline: true },
						{ name: "Name", value: name ?? "Unknown", inline: true },
						{
							name: "Organization",
							value: organizationId,
							inline: false,
						},
						{
							name: "Limit",
							value: formatAmount(capUsd, "USD"),
							inline: true,
						},
						{
							name: "Used",
							value: formatAmount(usedUsd, "USD"),
							inline: true,
						},
						{
							name: "Attempted",
							value: formatAmount(attemptedUsd, "USD"),
							inline: true,
						},
					],
					timestamp: new Date().toISOString(),
				},
			],
		},
		process.env.DISCORD_TOPUP_VELOCITY_NOTIFICATION_URL,
		DISCORD_ALERT_TIMEOUT_MS,
	);
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
	amount: number,
	currency: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "DevPass Subscribed",
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
						name: "Plan",
						value: `${devPlan.toUpperCase()} (${cycle})`,
						inline: true,
					},
					{
						name: "Amount",
						value: formatAmount(amount, currency),
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

export async function notifyDevPlanResumed(
	email: string,
	name: string | null | undefined,
	devPlan: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "DevPass Resumed",
				color: 0x10b981, // Emerald
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
	adminConversationUrl: string;
	ipAddress?: string;
	lastMessage?: string;
}): Promise<void> {
	const {
		name,
		email,
		conversationId,
		adminConversationUrl,
		ipAddress,
		lastMessage,
	} = args;
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
					url: adminConversationUrl,
					color: 0xf59e0b, // Amber
					fields: [
						{ name: "Name", value: name || "Not provided", inline: true },
						{ name: "Email", value: email || "Not provided", inline: true },
						{
							name: "Conversation ID",
							value: conversationId,
							inline: false,
						},
						{
							name: "Admin dashboard",
							value: `[View support ticket](${adminConversationUrl})`,
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

/**
 * A carrier asking to be added to its shared channel with our crew. Lands in
 * the provider-request channel so whoever handles listings can send the
 * invite to the address the carrier verified.
 */
export async function notifyAirsideCrewInvite(args: {
	companyName: string;
	email: string;
	website?: string | null;
	carriers: string[];
}): Promise<void> {
	const { companyName, email, website, carriers } = args;

	await sendDiscordNotification(
		{
			content: "\u{1F6E9}\uFE0F Airside carrier wants a crew channel invite.",
			embeds: [
				{
					title: "Airside Crew Invite Request",
					color: 0xf5a623, // Airside amber
					fields: [
						{ name: "Company", value: companyName, inline: true },
						{ name: "Invite", value: email, inline: true },
						...(website
							? [{ name: "Website", value: website, inline: false }]
							: []),
						{
							name: "Carriers",
							value: carriers.length > 0 ? carriers.join("\n") : "None yet",
							inline: false,
						},
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

export async function notifyChatPlanResumed(
	email: string,
	name: string | null | undefined,
	chatPlan: string,
): Promise<void> {
	const displayName = name ?? "Unknown";

	await sendDiscordNotification({
		embeds: [
			{
				title: "Chat Plan Resumed",
				color: 0x10b981,
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

export async function notifyHighRiskAccount(args: {
	email: string;
	name?: string | null;
	source: "signup" | "email_verification";
	reason: string;
	countryCode?: string | null;
	organizationIds: string[];
}): Promise<void> {
	await sendDiscordNotification(
		{
			embeds: [
				{
					title: "High-Risk Account Flagged",
					color: 0xf59e0b, // Amber
					fields: [
						{ name: "Email", value: args.email, inline: true },
						{ name: "Name", value: args.name ?? "Unknown", inline: true },
						{
							name: "Detected At",
							value:
								args.source === "signup" ? "Sign-up" : "Email verification",
							inline: true,
						},
						{ name: "Reason", value: args.reason, inline: false },
						{
							name: "Country",
							value: args.countryCode ?? "Unknown",
							inline: true,
						},
						{
							name: "Organizations",
							value: args.organizationIds.join(", ") || "None",
							inline: true,
						},
					],
					timestamp: new Date().toISOString(),
				},
			],
		},
		process.env.DISCORD_TOPUP_VELOCITY_NOTIFICATION_URL,
		DISCORD_ALERT_TIMEOUT_MS,
	);
}

export async function notifyUserAccountDeleted(
	email: string,
	name: string | null | undefined,
	teardown?: {
		closedOrganizations: number;
		cancelledSubscriptions: number;
		forfeitedCredits: string;
	},
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
					...(teardown
						? [
								{
									name: "Orgs Closed",
									value: String(teardown.closedOrganizations),
									inline: true,
								},
								{
									name: "Subscriptions Cancelled",
									value: String(teardown.cancelledSubscriptions),
									inline: true,
								},
								{
									name: "Credits Forfeited",
									value: `$${teardown.forfeitedCredits}`,
									inline: true,
								},
							]
						: []),
				],
				timestamp: new Date().toISOString(),
			},
		],
	});
}
