import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	ENTERPRISE_CONTACT_CONFIRM_SUBJECT,
	buildEnterpriseContactConfirmUrl,
	generateEnterpriseContactConfirmEmailHtml,
	signEnterpriseContactToken,
	verifyEnterpriseContactToken,
} from "@/lib/enterprise-contact.js";
import { createRoute } from "@/utils/create-route.js";
import { notifyEnterpriseContact } from "@/utils/discord.js";
import { sendTransactionalEmail } from "@/utils/email.js";
import { consumeRateLimit } from "@/utils/public-rate-limit.js";

import { and, db, eq, inArray, tables } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";
import { getClientIpFromContext } from "@llmgateway/shared/client-ip";
import {
	fromEmail,
	getResendClient,
	replyToEmail,
} from "@llmgateway/shared/email";
import { normalizeEmail } from "@llmgateway/shared/email-unsubscribe";

import type { ServerTypes } from "@/vars.js";

export const publicContact = new OpenAPIHono<ServerTypes>();

const contactFormSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.string().email("Invalid email address"),
	country: z.string().min(1, "Please select a country"),
	size: z.string().min(1, "Please select company size"),
	deployment: z.enum(["self_host", "cloud", "not_sure"]).optional(),
	message: z.string().min(10, "Message must be at least 10 characters"),
	honeypot: z.string().optional(),
	timestamp: z.number().optional(),
});

const deploymentLabels: Record<string, string> = {
	self_host: "Self-hosted",
	cloud: "Cloud (managed)",
	not_sure: "Not sure yet",
};

function deploymentLabel(value: string | undefined): string | null {
	if (!value) {
		return null;
	}
	return deploymentLabels[value] ?? value;
}

const contactResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour
// Confirmation emails one mailbox can be sent per day.
const CONFIRMATIONS_PER_EMAIL_PER_DAY = 3;
const DAY_SECONDS = 24 * 60 * 60;
const CONFIRMS_PER_IP_PER_HOUR = 20;
const SEND_TIMEOUT_MS = 10_000;

const disposableEmailDomains = [
	"tempmail.com",
	"10minutemail.com",
	"guerrillamail.com",
	"mailinator.com",
	"throwaway.email",
	"temp-mail.org",
	"getairmail.com",
	"trashmail.com",
	"yopmail.com",
];

const spamKeywords = [
	"casino",
	"viagra",
	"cialis",
	"lottery",
	"bitcoin",
	"cryptocurrency",
	"investment opportunity",
	"click here",
	"buy now",
	"limited time",
];

const submitEnterpriseContact = createRoute({
	method: "post",
	path: "/enterprise",
	request: {
		body: {
			content: {
				"application/json": {
					schema: contactFormSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: contactResponseSchema,
				},
			},
			description: "Confirmation email sent to the submitter",
		},
		400: {
			content: {
				"application/json": {
					schema: contactResponseSchema,
				},
			},
			description: "Submission rejected by validation or spam checks",
		},
		429: {
			content: {
				"application/json": {
					schema: contactResponseSchema,
				},
			},
			description: "Submission rejected by rate limiting",
		},
		500: {
			content: {
				"application/json": {
					schema: contactResponseSchema,
				},
			},
			description: "Submission could not be processed",
		},
	},
});

function checkForSpam(text: string): boolean {
	const lowerText = text.toLowerCase();
	return spamKeywords.some((keyword) => lowerText.includes(keyword));
}

function isDisposableEmail(email: string): boolean {
	const domain = email.split("@")[1]?.toLowerCase();
	return disposableEmailDomains.some((disposable) => domain === disposable);
}

async function checkRateLimit(identifier: string): Promise<boolean> {
	return await consumeRateLimit(
		`contact_rate_limit:${identifier}`,
		RATE_LIMIT_MAX,
		RATE_LIMIT_WINDOW_SECONDS,
	);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

type Submission = typeof tables.enterpriseContactSubmission.$inferSelect;

async function updateSubmissionStatus(
	submissionId: string,
	status: "rejected" | "unconfirmed" | "delivered" | "delivery_failed",
	rejectionReason?: string,
) {
	await db
		.update(tables.enterpriseContactSubmission)
		.set({
			spamFilterStatus: status,
			rejectionReason: rejectionReason ?? null,
		})
		.where(eq(tables.enterpriseContactSubmission.id, submissionId));
}

publicContact.openapi(submitEnterpriseContact, async (c) => {
	const validatedData = c.req.valid("json");
	const ipAddress = getClientIpFromContext(c);
	const userAgent = c.req.header("User-Agent") ?? null;

	let submission: { id: string };
	try {
		const [inserted] = await db
			.insert(tables.enterpriseContactSubmission)
			.values({
				name: validatedData.name,
				email: validatedData.email,
				country: validatedData.country,
				size: validatedData.size,
				deployment: validatedData.deployment ?? null,
				message: validatedData.message,
				honeypot: validatedData.honeypot ?? null,
				clientTimestampMs: validatedData.timestamp?.toString() ?? null,
				ipAddress,
				userAgent,
			})
			.returning({ id: tables.enterpriseContactSubmission.id });

		if (!inserted) {
			throw new Error("No row returned from insert");
		}
		submission = inserted;
	} catch (error) {
		logger.error("Failed to persist enterprise contact submission", {
			error,
		});
		return c.json(
			{
				success: false,
				message: "Failed to store submission. Please try again later.",
			},
			500,
		);
	}

	if (validatedData.honeypot && validatedData.honeypot.trim() !== "") {
		await updateSubmissionStatus(submission.id, "rejected", "honeypot");
		return c.json({ success: false, message: "Invalid submission" }, 400);
	}

	if (validatedData.timestamp) {
		const timeTaken = Date.now() - validatedData.timestamp;
		if (timeTaken < 3000) {
			await updateSubmissionStatus(
				submission.id,
				"rejected",
				"submitted_too_fast",
			);
			return c.json(
				{
					success: false,
					message: "Please take your time filling out the form",
				},
				400,
			);
		}
	}

	// Use IP when available; fall back to email so unknown-IP requests don't
	// share a single rate-limit bucket that any client can exhaust.
	const rateLimitKey = ipAddress ?? `email:${validatedData.email}`;
	const canSubmit = await checkRateLimit(rateLimitKey);
	if (!canSubmit) {
		await updateSubmissionStatus(submission.id, "rejected", "rate_limited");
		return c.json(
			{
				success: false,
				message:
					"Too many submissions. Please try again later (max 3 per hour)",
			},
			429,
		);
	}

	if (isDisposableEmail(validatedData.email)) {
		await updateSubmissionStatus(submission.id, "rejected", "disposable_email");
		return c.json(
			{
				success: false,
				message: "Please use a valid company email address",
			},
			400,
		);
	}

	const contentToCheck = `${validatedData.name} ${validatedData.message}`;
	if (checkForSpam(contentToCheck)) {
		await updateSubmissionStatus(submission.id, "rejected", "keyword_spam");
		return c.json(
			{
				success: false,
				message: "Your message contains prohibited content",
			},
			400,
		);
	}

	// The form must not become a way to fill someone else's inbox.
	const withinMailboxLimit = await consumeRateLimit(
		`enterprise_contact_confirmation:${normalizeEmail(validatedData.email)}`,
		CONFIRMATIONS_PER_EMAIL_PER_DAY,
		DAY_SECONDS,
	);
	if (!withinMailboxLimit) {
		await updateSubmissionStatus(
			submission.id,
			"rejected",
			"confirmation_rate_limited",
		);
		return c.json(
			{
				success: false,
				message:
					"Too many requests for this email address. Please try again tomorrow.",
			},
			429,
		);
	}

	// Sales hears about the request, and the visitor can book a call, only
	// once the visitor proves they own the address.
	try {
		await sendTransactionalEmail({
			to: validatedData.email,
			subject: ENTERPRISE_CONTACT_CONFIRM_SUBJECT,
			html: generateEnterpriseContactConfirmEmailHtml(
				validatedData.name,
				buildEnterpriseContactConfirmUrl(
					signEnterpriseContactToken(submission.id),
				),
			),
			strict: true,
			timeoutMs: SEND_TIMEOUT_MS,
		});
	} catch (error) {
		logger.error(
			"Failed to send enterprise contact confirmation",
			toError(error),
		);
		// Stays unconfirmed, so it never reaches sales or the CRM.
		await updateSubmissionStatus(
			submission.id,
			"unconfirmed",
			"confirmation_send_failed",
		);
		return c.json(
			{
				success: false,
				message:
					"Failed to send the confirmation email. Please try again later.",
			},
			500,
		);
	}

	await updateSubmissionStatus(submission.id, "unconfirmed");
	return c.json(
		{
			success: true,
			message: "Check your inbox to confirm your email address.",
		},
		200,
	);
});

function buildSalesEmailHtml(submission: Submission): string {
	const deployment = deploymentLabel(submission.deployment ?? undefined);
	return `
		<html>
			<head>
				<meta charset="UTF-8">
				<style>
					body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
					.container { max-width: 600px; margin: 0 auto; padding: 20px; }
					.header { background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
					.field { margin-bottom: 15px; }
					.label { font-weight: bold; color: #555; }
					.value { color: #333; margin-top: 5px; }
				</style>
			</head>
			<body>
				<div class="container">
					<div class="header">
						<h2 style="margin: 0; color: #2563eb;">New Enterprise Contact Request</h2>
					</div>

					<div class="field">
						<div class="label">Name:</div>
						<div class="value">${escapeHtml(submission.name)}</div>
					</div>

					<div class="field">
						<div class="label">Email (confirmed):</div>
						<div class="value">${escapeHtml(submission.email)}</div>
					</div>

					<div class="field">
						<div class="label">Country:</div>
						<div class="value">${escapeHtml(submission.country)}</div>
					</div>

					<div class="field">
						<div class="label">Company Size:</div>
						<div class="value">${escapeHtml(submission.size)}</div>
					</div>

					${
						deployment
							? `<div class="field">
						<div class="label">Deployment:</div>
						<div class="value">${escapeHtml(deployment)}</div>
					</div>`
							: ""
					}

					<div class="field">
						<div class="label">Message:</div>
						<div class="value" style="white-space: pre-wrap;">${escapeHtml(submission.message)}</div>
					</div>
				</div>
			</body>
		</html>
	`;
}

/** Hands a confirmed request to the sales inbox and Discord. */
async function deliverToSales(submission: Submission): Promise<void> {
	const resend = getResendClient();
	if (!resend) {
		logger.error(
			"Resend is not configured; enterprise contact request not delivered",
			{ submissionId: submission.id },
		);
		await updateSubmissionStatus(
			submission.id,
			"delivery_failed",
			"resend_not_configured",
		);
		return;
	}

	const { error } = await resend.emails.send({
		from: fromEmail,
		to: [replyToEmail],
		replyTo: submission.email,
		subject: `Enterprise Contact Request from ${submission.name}`,
		html: buildSalesEmailHtml(submission),
	});
	if (error) {
		logger.error(
			"Failed to send enterprise contact email",
			new Error(error.message),
		);
		await updateSubmissionStatus(
			submission.id,
			"delivery_failed",
			"resend_send_failed",
		);
		return;
	}

	// Fire-and-forget: don't block the response on the Discord webhook.
	// notifyEnterpriseContact already logs its own failures; the extra catch
	// guards against an unexpected rejection becoming an unhandled rejection.
	void notifyEnterpriseContact({
		name: submission.name,
		email: submission.email,
		country: submission.country,
		size: submission.size,
		deployment: deploymentLabel(submission.deployment ?? undefined),
		message: submission.message,
		ipAddress: submission.ipAddress,
	}).catch((err) => {
		logger.error(
			"Failed to send enterprise Discord notification",
			err instanceof Error ? err : new Error(String(err)),
		);
	});
}

const confirmEnterpriseContact = createRoute({
	method: "post",
	path: "/enterprise/confirm",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ token: z.string().min(1) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: contactResponseSchema.extend({
						name: z.string(),
						email: z.string(),
					}),
				},
			},
			description: "Email confirmed; the visitor can book a call",
		},
		400: {
			content: {
				"application/json": {
					schema: contactResponseSchema.extend({
						invalidLink: z.literal(true),
					}),
				},
			},
			description: "Invalid or expired link",
		},
		429: {
			content: {
				"application/json": {
					schema: contactResponseSchema,
				},
			},
			description: "Rate limit exceeded",
		},
	},
});

publicContact.openapi(confirmEnterpriseContact, async (c) => {
	const invalidLink = () =>
		c.json(
			{
				success: false,
				message: "This confirmation link is invalid or has expired.",
				invalidLink: true as const,
			},
			400,
		);

	const submissionId = verifyEnterpriseContactToken(c.req.valid("json").token);
	if (!submissionId) {
		return invalidLink();
	}

	const ipAddress = getClientIpFromContext(c);
	const withinIpLimit = await consumeRateLimit(
		`enterprise_contact_confirm_rate_limit:${ipAddress ?? `submission:${submissionId}`}`,
		CONFIRMS_PER_IP_PER_HOUR,
		RATE_LIMIT_WINDOW_SECONDS,
	);
	if (!withinIpLimit) {
		return c.json(
			{
				success: false,
				message: "Too many requests. Please try again later.",
			},
			429,
		);
	}

	const t = tables.enterpriseContactSubmission;
	const [submission] = await db
		.select()
		.from(t)
		.where(eq(t.id, submissionId))
		.limit(1);
	if (!submission) {
		return invalidLink();
	}

	// delivery_failed here means the sales email failed after an earlier
	// confirmation, so another click retries it.
	const deliverable = ["unconfirmed", "delivery_failed"] as const;
	if (
		submission.spamFilterStatus === "unconfirmed" ||
		submission.spamFilterStatus === "delivery_failed"
	) {
		// Claim the row first so a double click delivers to sales only once.
		const [claimed] = await db
			.update(t)
			.set({ spamFilterStatus: "delivered", rejectionReason: null })
			.where(
				and(
					eq(t.id, submission.id),
					inArray(t.spamFilterStatus, [...deliverable]),
				),
			)
			.returning({ id: t.id });
		if (claimed) {
			await deliverToSales(submission);
		}
	} else if (submission.spamFilterStatus !== "delivered") {
		return invalidLink();
	}

	return c.json(
		{
			success: true,
			message: "Email confirmed.",
			name: submission.name,
			email: submission.email,
		},
		200,
	);
});
