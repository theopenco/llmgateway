import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { redisClient } from "@/auth/config.js";

import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	fromEmail,
	getResendClient,
	replyToEmail,
} from "@llmgateway/shared/email";

import type { ServerTypes } from "@/vars.js";

export const publicContact = new OpenAPIHono<ServerTypes>();

const contactFormSchema = z.object({
	name: z.string().min(2, "Name must be at least 2 characters"),
	email: z.string().email("Invalid email address"),
	country: z.string().min(1, "Please select a country"),
	size: z.string().min(1, "Please select company size"),
	message: z.string().min(10, "Message must be at least 10 characters"),
	honeypot: z.string().optional(),
	timestamp: z.number().optional(),
});

const contactResponseSchema = z.object({
	success: z.boolean(),
	message: z.string(),
});

const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SECONDS = 60 * 60; // 1 hour

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
			description: "Enterprise contact request handled successfully",
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

function extractClientIP(c: {
	req: { header: (name: string) => string | undefined };
}): string | null {
	// CF-Connecting-IP is set by Cloudflare and cannot be spoofed by clients.
	// This is the only fully trusted header when deployed behind Cloudflare.
	const cfConnectingIP = c.req.header("CF-Connecting-IP");
	if (cfConnectingIP) {
		return cfConnectingIP;
	}

	// X-Forwarded-For is spoofable unless stripped by a trusted reverse proxy.
	// Only use as a fallback (e.g. non-Cloudflare environments like local dev).
	const xForwardedFor = c.req.header("X-Forwarded-For");
	if (xForwardedFor) {
		return xForwardedFor.split(",")[0]?.trim() ?? null;
	}

	return c.req.header("X-Real-IP") ?? null;
}

function checkForSpam(text: string): boolean {
	const lowerText = text.toLowerCase();
	return spamKeywords.some((keyword) => lowerText.includes(keyword));
}

function isDisposableEmail(email: string): boolean {
	const domain = email.split("@")[1]?.toLowerCase();
	return disposableEmailDomains.some((disposable) => domain === disposable);
}

async function checkRateLimit(identifier: string): Promise<boolean> {
	const key = `contact_rate_limit:${identifier}`;
	try {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, RATE_LIMIT_WINDOW_SECONDS);
		}
		return count <= RATE_LIMIT_MAX;
	} catch (error) {
		logger.error("Rate limit check failed", {
			error,
			identifier,
		});
		// Fail open — allow the request if Redis is down
		return true;
	}
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

async function updateSubmissionStatus(
	submissionId: string,
	status: "rejected" | "delivered" | "delivery_failed",
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
	const ipAddress = extractClientIP(c);
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

	const resend = getResendClient();
	if (!resend) {
		await updateSubmissionStatus(
			submission.id,
			"delivery_failed",
			"resend_not_configured",
		);
		return c.json(
			{
				success: false,
				message: "Email service is not configured. Please try again later.",
			},
			500,
		);
	}

	const htmlContent = `
		<html>
			<head>
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
						<div class="value">${escapeHtml(validatedData.name)}</div>
					</div>

					<div class="field">
						<div class="label">Email:</div>
						<div class="value">${escapeHtml(validatedData.email)}</div>
					</div>

					<div class="field">
						<div class="label">Country:</div>
						<div class="value">${escapeHtml(validatedData.country)}</div>
					</div>

					<div class="field">
						<div class="label">Company Size:</div>
						<div class="value">${escapeHtml(validatedData.size)}</div>
					</div>

					<div class="field">
						<div class="label">Message:</div>
						<div class="value" style="white-space: pre-wrap;">${escapeHtml(validatedData.message)}</div>
					</div>
				</div>
			</body>
		</html>
	`;

	const { error } = await resend.emails.send({
		from: fromEmail,
		to: [replyToEmail],
		replyTo: validatedData.email,
		subject: `Enterprise Contact Request from ${validatedData.name}`,
		html: htmlContent,
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
		return c.json(
			{
				success: false,
				message: "Failed to send email. Please try again later.",
			},
			500,
		);
	}

	try {
		await updateSubmissionStatus(submission.id, "delivered");
	} catch (err) {
		logger.error("Failed to update submission status after delivery", {
			submissionId: submission.id,
			error: err,
		});
	}
	return c.json({ success: true, message: "Email sent successfully" }, 200);
});
