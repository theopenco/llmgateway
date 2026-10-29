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
		return new ResendWithTimeout(resendApiKey, timeoutMs);
	}
	resendClient ??= new Resend(resendApiKey);
	return resendClient;
}

export { fromEmail, replyToEmail, resendAudienceId, getResendClient };
export class ResendWithTimeout extends Resend {
	public constructor(
		key: string,
		private readonly timeoutMs: number,
	) {
		super(key);
	}

	public override async fetchRequest<T>(
		path: string,
		options: RequestInit = {},
	) {
		return await super.fetchRequest<T>(path, {
			...options,
			signal: AbortSignal.timeout(this.timeoutMs),
		});
	}
}
