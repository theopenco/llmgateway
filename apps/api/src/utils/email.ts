import nodemailer from "nodemailer";

import { logger } from "@llmgateway/logger";

/**
 * Escapes HTML special characters to prevent XSS attacks
 */
function escapeHtml(text: string): string {
	const htmlEscapeMap: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#x27;",
		"/": "&#x2F;",
	};
	return text.replace(/[&<>"'/]/g, (char) => htmlEscapeMap[char] || char);
}

const smtpHost = process.env.SMTP_HOST;
const smtpPort = parseInt(process.env.SMTP_PORT || "587", 10);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFromEmail =
	process.env.SMTP_FROM_EMAIL || "contact@email.llmgateway.io";
const replyToEmail = process.env.SMTP_REPLY_TO_EMAIL || "contact@llmgateway.io";
const uiUrl = process.env.UI_URL || "http://localhost:3002";

export interface TransactionalEmailOptions {
	to: string;
	subject: string;
	html: string;
}

export async function sendTransactionalEmail({
	to,
	subject,
	html,
}: TransactionalEmailOptions): Promise<void> {
	// In non-production environments, just log the email content
	if (process.env.NODE_ENV !== "production") {
		logger.info("Email content (not sent in non-production)", {
			to,
			subject,
			html,
			from: smtpFromEmail,
			replyTo: replyToEmail,
		});
		return;
	}

	if (!smtpHost || !smtpUser || !smtpPass) {
		logger.error(
			"SMTP configuration is not set. Transactional email will not be sent.",
			new Error(
				`SMTP not configured for email to ${to} with subject: ${subject}`,
			),
		);
		return;
	}

	const transporter = nodemailer.createTransport({
		host: smtpHost,
		port: smtpPort,
		secure: smtpPort === 465,
		auth: {
			user: smtpUser,
			pass: smtpPass,
		},
	});

	try {
		await transporter.sendMail({
			from: smtpFromEmail,
			replyTo: replyToEmail,
			to,
			subject,
			html,
		});

		logger.info("Transactional email sent successfully", {
			to,
			subject,
		});
	} catch (error) {
		logger.error(
			"Failed to send transactional email",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

export function generateTrialStartedEmailHtml(
	organizationName: string,
	trialEndDate: Date,
): string {
	const formattedEndDate = trialEndDate.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Welcome to LLMGateway Pro Trial</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
	<div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
		<h1 style="color: #2563eb; margin-top: 0;">Welcome to LLMGateway Pro Trial!</h1>
		<p style="font-size: 16px; margin-bottom: 20px;">
			Hi there,
		</p>
		<p style="font-size: 16px; margin-bottom: 20px;">
			Great news! Your 7-day Pro trial for <strong>${escapeHtml(organizationName)}</strong> has started. You now have access to all Pro features including:
		</p>
		<ul style="font-size: 16px; margin-bottom: 20px; padding-left: 20px;">
			<li>Provider API key management (bring your own keys)</li>
			<li>No fees on credit top-ups</li>
			<li>Extended data retention (90 days)</li>
			<li>Team management</li>
			<li>Advanced analytics and insights</li>
			<li>Priority support</li>
		</ul>
		<p style="font-size: 16px; margin-bottom: 20px;">
			Your trial will end on <strong>${formattedEndDate}</strong>. After that, you'll be charged for your Pro subscription unless you cancel before the trial ends.
		</p>
		<div style="text-align: center; margin: 30px 0;">
			<a href="${uiUrl}/dashboard" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500;">Go to Dashboard</a>
		</div>
		<p style="font-size: 14px; color: #666; margin-top: 30px;">
			Need help getting started? Reply to this email and we'll be happy to assist you!
		</p>
	</div>
	<div style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
		<p>LLMGateway - Your LLM API Gateway Platform</p>
	</div>
</body>
</html>
	`.trim();
}

export function generateSubscriptionCancelledEmailHtml(
	organizationName: string,
): string {
	return `
<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Subscription Cancelled - LLMGateway</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
	<div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
		<h1 style="color: #dc2626; margin-top: 0;">Your Subscription Has Been Cancelled</h1>
		<p style="font-size: 16px; margin-bottom: 20px;">
			Hi there,
		</p>
		<p style="font-size: 16px; margin-bottom: 20px;">
			We're sorry to see you go. Your Pro subscription for <strong>${escapeHtml(organizationName)}</strong> has been cancelled and your organization has been downgraded to the free plan.
		</p>
		<p style="font-size: 16px; margin-bottom: 20px;">
			You can continue using LLMGateway with our free plan features, or you can resubscribe to Pro at any time from your dashboard.
		</p>
		<div style="text-align: center; margin: 30px 0;">
			<a href="${uiUrl}/dashboard/settings/billing" style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500;">Manage Subscription</a>
		</div>
		<p style="font-size: 14px; color: #666; margin-top: 30px;">
			We'd love to hear your feedback! Reply to this email and let us know why you cancelled or how we can improve.
		</p>
	</div>
	<div style="text-align: center; font-size: 12px; color: #999; margin-top: 20px;">
		<p>LLMGateway - Your LLM API Gateway Platform</p>
	</div>
</body>
</html>
	`.trim();
}
