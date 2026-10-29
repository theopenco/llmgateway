import { Resend } from "resend";

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail =
	process.env.RESEND_FROM_EMAIL ?? "LLMGateway <contact@mail.llmgateway.io>";
const replyToEmail =
	process.env.RESEND_REPLY_TO_EMAIL ?? "contact@llmgateway.io";
const resendAudienceId = process.env.RESEND_AUDIENCE_ID ?? "";

let resendClient: Resend | null = null;

function getResendClient(timeoutMs?: number): Resend | null {
	if (!resendApiKey) {
		return null;
	}
	if (timeoutMs !== undefined) {
		return createResendClient(resendApiKey, timeoutMs);
	}
	resendClient ??= new Resend(resendApiKey);
	return resendClient;
}

export { fromEmail, replyToEmail, resendAudienceId, getResendClient };
export function createResendClient(key: string, timeoutMs: number): Resend {
	// Composition survives shared's ES5 output; native SDK subclasses do not.
	const client = new Resend(key);
	const request = client.fetchRequest.bind(client);
	client.fetchRequest = <T>(path: string, options: RequestInit = {}) =>
		request<T>(path, {
			...options,
			signal: AbortSignal.timeout(timeoutMs),
		});
	return client;
}
