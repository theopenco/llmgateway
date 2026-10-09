export interface DiscordEmbed {
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

export interface DiscordWebhookPayload {
	content?: string;
	embeds?: DiscordEmbed[];
}

/** Posts to a Discord webhook; throws on a network error or non-2xx reply. */
export async function postDiscordWebhook(
	webhookUrl: string,
	payload: DiscordWebhookPayload,
	options: { timeoutMs?: number } = {},
): Promise<void> {
	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
		...(options.timeoutMs
			? { signal: AbortSignal.timeout(options.timeoutMs) }
			: {}),
	});

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Discord webhook error: ${response.status} - ${errorText}`);
	}
}
