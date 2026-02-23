import { Resend } from "resend";

import { logger } from "@llmgateway/logger";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail =
	process.env.RESEND_FROM_EMAIL ?? "LLMGateway <contact@mail.llmgateway.io>";
const replyToEmail =
	process.env.RESEND_REPLY_TO_EMAIL ?? "contact@llmgateway.io";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
	if (!resendApiKey) {
		return null;
	}
	resendClient ??= new Resend(resendApiKey);
	return resendClient;
}

export async function sendFollowUpEmail(opts: {
	to: string;
	subject: string;
	text: string;
}): Promise<void> {
	const client = getResendClient();
	if (!client) {
		logger.error(
			"RESEND_API_KEY is not configured. Follow-up email will not be sent.",
			new Error(
				`Resend not configured for email to ${opts.to} with subject: ${opts.subject}`,
			),
		);
		return;
	}

	const { data, error } = await client.emails.send({
		from: fromEmail,
		to: [opts.to],
		replyTo: replyToEmail,
		subject: opts.subject,
		text: opts.text,
	});

	if (error) {
		throw new Error(`Resend API error: ${error.message}`);
	}

	logger.info("Follow-up email sent successfully", {
		to: opts.to,
		subject: opts.subject,
		messageId: data?.id,
	});
}
