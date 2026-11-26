import { Resend } from "resend";

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

export { fromEmail, replyToEmail, getResendClient };
