import { Resend } from "resend";

let resendClient: Resend | null = null;
let resendClientApiKey: string | undefined;

export function getFromEmail(): string {
	return (
		process.env.RESEND_FROM_EMAIL ?? "LLMGateway <contact@mail.llmgateway.io>"
	);
}

export function getReplyToEmail(): string {
	return process.env.RESEND_REPLY_TO_EMAIL ?? "contact@llmgateway.io";
}

export function getResendAudienceId(): string {
	return process.env.RESEND_AUDIENCE_ID ?? "";
}

function getResendClient(): Resend | null {
	const resendApiKey = process.env.RESEND_API_KEY;
	if (!resendApiKey) {
		resendClient = null;
		resendClientApiKey = undefined;
		return null;
	}

	if (!resendClient || resendClientApiKey !== resendApiKey) {
		resendClient = new Resend(resendApiKey);
		resendClientApiKey = resendApiKey;
	}

	return resendClient;
}

export { getResendClient };
