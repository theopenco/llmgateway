/* eslint-disable no-console */
import {
	buildUnsubscribeHeaders,
	renderFooterText,
	signUnsubscribeToken,
} from "@llmgateway/shared/email-unsubscribe";

import type { Resend } from "resend";

const FROM = "Luca from LLMGateway <contact@mail.llmgateway.io>";
const REPLY_TO = "luca.steeb@llmgateway.io";

export interface MarketingEmail {
	to: string;
	subject: string;
	text: string;
}

export async function sleep(ms: number) {
	return await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendMarketingEmail(
	resend: Resend,
	email: MarketingEmail,
	maxRetries = 5,
): Promise<{ success: boolean; id?: string; error?: unknown }> {
	const token = signUnsubscribeToken({
		email: email.to,
		category: "marketing",
	});

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		const { data, error } = await resend.emails.send({
			from: FROM,
			to: email.to,
			subject: email.subject,
			text: `${email.text}${renderFooterText("marketing", token)}`,
			replyTo: REPLY_TO,
			headers: buildUnsubscribeHeaders(token),
		});

		if (!error) {
			return { success: true, id: data?.id };
		}

		if (
			typeof error === "object" &&
			error !== null &&
			"statusCode" in error &&
			error.statusCode === 429
		) {
			const backoffMs = Math.pow(2, attempt) * 1000;
			console.log(
				`Rate limited for ${email.to}, waiting ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`,
			);
			await sleep(backoffMs);
			continue;
		}

		return { success: false, error };
	}

	return { success: false, error: "Max retries exceeded" };
}
