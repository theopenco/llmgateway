import { signLinkToken, verifyLinkToken } from "@/lib/signed-token.js";

import {
	POSTAL_ADDRESS,
	escapeHtml,
} from "@llmgateway/shared/email-unsubscribe";

const TOKEN_DOMAIN = "enterprise-contact-confirm";
const TOKEN_TTL_DAYS = 7;
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 86_400_000;

export const ENTERPRISE_CONTACT_CONFIRM_SUBJECT =
	"Confirm your email to book your LLM Gateway call";

export function signEnterpriseContactToken(
	submissionId: string,
	now: Date = new Date(),
): string {
	return signLinkToken(
		TOKEN_DOMAIN,
		{ s: submissionId },
		now.getTime() + TOKEN_TTL_MS,
	);
}

/** The submission a confirmation link was issued for, or null when invalid. */
export function verifyEnterpriseContactToken(
	token: string,
	now: Date = new Date(),
): string | null {
	return verifyLinkToken<{ s: string }>(TOKEN_DOMAIN, token, now)?.s ?? null;
}

export function buildEnterpriseContactConfirmUrl(token: string): string {
	const url = new URL(
		"/enterprise/confirm",
		process.env.UI_URL ?? "https://llmgateway.io",
	);
	url.searchParams.set("token", token);
	return url.toString();
}

export function generateEnterpriseContactConfirmEmailHtml(
	name: string,
	confirmUrl: string,
): string {
	const href = escapeHtml(confirmUrl);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background-color:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f6f6f6;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:8px;">
<tr><td style="padding:32px;">
<p style="margin:0 0 16px;color:#111111;font-size:18px;font-weight:600;">Hi ${escapeHtml(name)}, confirm your email</p>
<p style="margin:0 0 24px;color:#333333;font-size:15px;line-height:1.6;">Thanks for your interest in LLM Gateway Enterprise. Confirm your email address to send your request to our team and book a call.</p>
<p style="margin:0 0 24px;"><a href="${href}" style="display:inline-block;background-color:#111111;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:6px;">Confirm email and book a call</a></p>
<p style="margin:0;color:#666666;font-size:13px;line-height:1.6;">The link works for ${TOKEN_TTL_DAYS} days. If you didn't ask for this, ignore this email.</p>
</td></tr>
<tr><td style="padding:20px 32px;background-color:#fafafa;border-top:1px solid #eeeeee;border-radius:0 0 8px 8px;color:#888888;font-size:12px;line-height:1.6;">
LLM Gateway. ${escapeHtml(POSTAL_ADDRESS)}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
