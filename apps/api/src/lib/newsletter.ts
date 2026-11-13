import { expectResendOk, resendContactPath } from "@/lib/resend-contacts.js";
import { signLinkToken, verifyLinkToken } from "@/lib/signed-token.js";

import {
	POSTAL_ADDRESS,
	escapeHtml,
	normalizeEmail,
} from "@llmgateway/shared/email-unsubscribe";
import { resendFetch } from "@llmgateway/shared/resend-api";

const TOKEN_DOMAIN = "newsletter-confirm";
const TOKEN_TTL_DAYS = 7;
const TOKEN_TTL_MS = TOKEN_TTL_DAYS * 86_400_000;
const SEGMENT_PAGE_SIZE = 100;

export const NEWSLETTER_CONFIRM_SUBJECT =
	"Confirm your LLM Gateway newsletter subscription";

export interface NewsletterTarget {
	apiKey: string;
	topicId: string;
	segmentId: string | undefined;
}

export function signNewsletterToken(
	email: string,
	now: Date = new Date(),
): string {
	return signLinkToken(
		TOKEN_DOMAIN,
		{ e: normalizeEmail(email) },
		now.getTime() + TOKEN_TTL_MS,
	);
}

/**
 * The address a confirmation link was issued for, or null when the token is
 * forged, malformed or expired.
 */
export function verifyNewsletterToken(
	token: string,
	now: Date = new Date(),
): string | null {
	return verifyLinkToken<{ e: string }>(TOKEN_DOMAIN, token, now)?.e ?? null;
}

export function buildNewsletterConfirmUrl(token: string): string {
	const url = new URL(
		"/newsletter/confirm",
		process.env.UI_URL ?? "https://llmgateway.io",
	);
	url.searchParams.set("token", token);
	return url.toString();
}

export function generateNewsletterConfirmEmailHtml(confirmUrl: string): string {
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
<p style="margin:0 0 16px;color:#111111;font-size:18px;font-weight:600;">Confirm your subscription</p>
<p style="margin:0 0 24px;color:#333333;font-size:15px;line-height:1.6;">One click and you'll get a short email when new models land on LLM Gateway.</p>
<p style="margin:0 0 24px;"><a href="${href}" style="display:inline-block;background-color:#111111;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:6px;">Confirm subscription</a></p>
<p style="margin:0;color:#666666;font-size:13px;line-height:1.6;">The link works for ${TOKEN_TTL_DAYS} days. If you didn't ask for this, ignore this email and you won't hear from us.</p>
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

async function isInSegment(
	target: NewsletterTarget,
	contactPath: string,
	segmentId: string,
): Promise<boolean> {
	const response = await expectResendOk(
		await resendFetch({
			apiKey: target.apiKey,
			method: "GET",
			path: `${contactPath}/segments?limit=${SEGMENT_PAGE_SIZE}`,
		}),
	);
	const body = (await response.json()) as { data: { id: string }[] };
	return body.data.some((segment) => segment.id === segmentId);
}

/**
 * Opts a contact that already exists back in. Topics have their own endpoint,
 * and a broadcast only reaches contacts in its segment.
 */
async function resubscribe(
	target: NewsletterTarget,
	contactPath: string,
	unsubscribed: boolean,
): Promise<void> {
	if (unsubscribed) {
		await expectResendOk(
			await resendFetch({
				apiKey: target.apiKey,
				method: "PATCH",
				path: contactPath,
				body: { unsubscribed: false },
			}),
		);
	}
	await expectResendOk(
		await resendFetch({
			apiKey: target.apiKey,
			method: "PATCH",
			path: `${contactPath}/topics`,
			body: [{ id: target.topicId, subscription: "opt_in" }],
		}),
	);
	if (
		target.segmentId &&
		!(await isInSegment(target, contactPath, target.segmentId))
	) {
		await expectResendOk(
			await resendFetch({
				apiKey: target.apiKey,
				method: "POST",
				path: `${contactPath}/segments/${encodeURIComponent(target.segmentId)}`,
			}),
		);
	}
}

/** Subscribes an address whose owner confirmed it. Safe to repeat. */
export async function subscribeToNewsletter(
	target: NewsletterTarget,
	email: string,
): Promise<void> {
	const contactPath = resendContactPath(email);
	const lookup = await resendFetch({
		apiKey: target.apiKey,
		method: "GET",
		path: contactPath,
	});
	if (lookup.ok) {
		const contact = (await lookup.json()) as { unsubscribed?: boolean };
		await resubscribe(target, contactPath, contact.unsubscribed === true);
		return;
	}
	if (lookup.status !== 404) {
		await expectResendOk(lookup);
	}

	const created = await resendFetch({
		apiKey: target.apiKey,
		method: "POST",
		path: "/contacts",
		body: {
			email,
			unsubscribed: false,
			topics: [{ id: target.topicId, subscription: "opt_in" }],
			...(target.segmentId && { segments: [{ id: target.segmentId }] }),
		},
	});
	if (created.status === 409 || created.status === 422) {
		// The contact was created between the lookup and the create.
		await resubscribe(target, contactPath, true);
		return;
	}
	await expectResendOk(created);
}
