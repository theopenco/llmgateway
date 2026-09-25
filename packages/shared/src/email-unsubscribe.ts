import { createHmac, timingSafeEqual } from "node:crypto";

import { getApiKeyHashSecret, getApiKeyHashSecrets } from "./api-key-hash.js";

/**
 * Categories that also appear in the in-app notification feed. Delivery for
 * these is a per-user preference on top of the address-level suppression list.
 */
export const notificationCategories = [
	"budget",
	"model_retirement",
	"provider_issue",
	"model_available",
	"compliance_downgrade",
] as const;
export type NotificationCategory = (typeof notificationCategories)[number];

/**
 * Optional email categories a recipient can unsubscribe from. Everything not
 * listed here is transactional and can only be stopped by closing the account.
 */
export const emailCategories = [
	...notificationCategories,
	"marketing",
	"credit_alerts",
] as const;
export type EmailCategory = (typeof emailCategories)[number];

/** Categories delivered by email only; they have no in-app counterpart. */
export type EmailOnlyCategory = Exclude<EmailCategory, NotificationCategory>;

export type EmailFooterKind = "transactional" | EmailCategory;

const TOKEN_VERSION = "v1";

const CATEGORY_LABELS: Record<EmailCategory, string> = {
	budget: "API key budget warnings",
	model_retirement: "model retirement notices",
	provider_issue: "provider incident alerts",
	model_available: "compliance model availability alerts",
	compliance_downgrade: "compliance downgrade alerts",
	marketing: "product tips and offers",
	credit_alerts: "credit balance reminders",
};

const POSTAL_ADDRESS =
	"Polar Lights LLC, 16192 Coastal Highway, Lewes, DE 19958, United States";

interface UnsubscribeTokenPayload {
	e: string;
	c: EmailCategory;
}

export function isEmailCategory(value: string): value is EmailCategory {
	return (emailCategories as readonly string[]).includes(value);
}

export function isNotificationCategory(
	value: string,
): value is NotificationCategory {
	return (notificationCategories as readonly string[]).includes(value);
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function getEmailCategoryLabel(category: EmailCategory): string {
	return CATEGORY_LABELS[category];
}

function sign(payload: string, secret: string): string {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signUnsubscribeToken(input: {
	email: string;
	category: EmailCategory;
}): string {
	const payload = Buffer.from(
		JSON.stringify({
			e: normalizeEmail(input.email),
			c: input.category,
		} satisfies UnsubscribeTokenPayload),
	).toString("base64url");

	return `${TOKEN_VERSION}.${payload}.${sign(payload, getApiKeyHashSecret())}`;
}

/**
 * Verifies against every keyring entry so rotating GATEWAY_API_KEY_HASH_SECRET
 * does not break unsubscribe links already sitting in people's inboxes.
 */
export function verifyUnsubscribeToken(
	token: string,
): { email: string; category: EmailCategory } | null {
	const segments = token.split(".");
	if (segments.length !== 3) {
		return null;
	}

	const [version, payload, signature] = segments;
	if (version !== TOKEN_VERSION || !payload || !signature) {
		return null;
	}

	const provided = Buffer.from(signature);
	const matches = getApiKeyHashSecrets().some((secret) => {
		const expected = Buffer.from(sign(payload, secret));
		return (
			provided.length === expected.length && timingSafeEqual(provided, expected)
		);
	});
	if (!matches) {
		return null;
	}

	try {
		const decoded = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as Partial<UnsubscribeTokenPayload>;
		if (
			typeof decoded.e !== "string" ||
			!decoded.e ||
			typeof decoded.c !== "string" ||
			!isEmailCategory(decoded.c)
		) {
			return null;
		}
		return { email: normalizeEmail(decoded.e), category: decoded.c };
	} catch {
		return null;
	}
}

function getApiUrl(): string {
	return process.env.API_URL ?? "https://internal.llmgateway.io";
}

function getUiUrl(): string {
	return process.env.UI_URL ?? "https://llmgateway.io";
}

/**
 * The one-click endpoint lives on the API because mail providers POST to this
 * exact URL (RFC 8058); it redirects browsers on to the dashboard page.
 */
export function buildUnsubscribeUrl(token: string): string {
	const url = new URL("/public/unsubscribe", getApiUrl());
	url.searchParams.set("token", token);
	return url.toString();
}

export function buildUnsubscribeHeaders(token: string): Record<string, string> {
	return {
		"List-Unsubscribe": `<${buildUnsubscribeUrl(token)}>, <mailto:contact@llmgateway.io?subject=unsubscribe>`,
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	};
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

const TRANSACTIONAL_NOTE =
	"This is a transactional email about your account and can't be unsubscribed from. To stop receiving it, close your LLM Gateway account";

export function renderFooterText(
	kind: EmailFooterKind,
	token?: string,
): string {
	if (kind === "transactional") {
		return `\n\n---\n${TRANSACTIONAL_NOTE} at ${getUiUrl()}/dashboard.\n© ${new Date().getFullYear()} LLM Gateway. ${POSTAL_ADDRESS}`;
	}

	const unsubscribe = token
		? `Unsubscribe from ${CATEGORY_LABELS[kind]}: ${buildUnsubscribeUrl(token)}`
		: `Manage which emails you receive: ${getUiUrl()}/dashboard`;

	return `\n\n---\nYou're receiving this because you have an LLM Gateway account.\n${unsubscribe}\n© ${new Date().getFullYear()} LLM Gateway. ${POSTAL_ADDRESS}`;
}

/**
 * The legal notice paragraphs of an email footer: what this email is, how to
 * stop it, and the postal address. Split out so templates with their own footer
 * copy (e.g. invoices) can carry the notice without losing their own wording.
 */
export function renderFooterNoticeHtml(
	kind: EmailFooterKind,
	token?: string,
): string {
	const note =
		kind === "transactional"
			? `${escapeHtml(TRANSACTIONAL_NOTE)} at <a href="${getUiUrl()}/dashboard" style="color: #666666;">your dashboard</a>.`
			: token
				? `You're receiving this because you have an LLM Gateway account. <a href="${escapeHtml(buildUnsubscribeUrl(token))}" style="color: #666666;">Unsubscribe from ${escapeHtml(CATEGORY_LABELS[kind])}</a>.`
				: `You're receiving this because you have an LLM Gateway account. <a href="${getUiUrl()}/dashboard" style="color: #666666;">Manage which emails you receive</a>.`;

	return `<p style="margin: 0 0 8px; color: #999999; font-size: 12px; line-height: 1.6;">
								${note}
							</p>
							<p style="margin: 0; color: #999999; font-size: 12px;">
								© ${new Date().getFullYear()} LLM Gateway. ${escapeHtml(POSTAL_ADDRESS)}
							</p>`;
}

export function renderFooterHtml(
	kind: EmailFooterKind,
	token?: string,
): string {
	return `<!-- Footer -->
					<tr>
						<td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
							<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
								Need help? Check out our <a
									href="https://docs.llmgateway.io" style="color: #000000; text-decoration: none;"
								>documentation</a> or reply to this email for any questions.
							</p>
							${renderFooterNoticeHtml(kind, token)}
						</td>
					</tr>`;
}
