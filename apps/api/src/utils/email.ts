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
const smtpFromEmail = process.env.SMTP_FROM_EMAIL || "contact@llmgateway.io";
const replyToEmail = process.env.SMTP_REPLY_TO_EMAIL || "contact@llmgateway.io";

export interface TransactionalEmailOptions {
	to: string;
	subject: string;
	html: string;
	attachments?: Array<{
		filename: string;
		content: Buffer;
		contentType?: string;
	}>;
}

export async function sendTransactionalEmail({
	to,
	subject,
	html,
	attachments,
}: TransactionalEmailOptions): Promise<void> {
	// In non-production environments, just log the email content
	if (process.env.NODE_ENV !== "production") {
		logger.info("Email content (not sent in non-production)", {
			to,
			subject,
			html,
			attachments: attachments?.map((a) => ({
				filename: a.filename,
				size: a.content.length,
			})),
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
			from: `LLMGateway <${smtpFromEmail}>`,
			replyTo: replyToEmail,
			to,
			subject,
			html,
			attachments: attachments?.map((att) => ({
				filename: att.filename,
				content: att.content,
				contentType: att.contentType,
			})),
		});

		logger.info("Transactional email sent successfully", {
			to,
			subject,
			hasAttachments: !!attachments?.length,
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
	const escapedOrgName = escapeHtml(organizationName);
	const formattedEndDate = trialEndDate.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

	return `
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Welcome to LLMGateway Pro</title>
	</head>
	<body
		style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #ffffff;"
	>
		<table role="presentation" style="width: 100%; border-collapse: collapse;">
			<tr>
				<td align="center" style="padding: 40px 20px;">
					<table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse;">
						<!-- Header -->
						<tr>
							<td
								style="background-color: #000000; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;"
							>
								<h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Welcome to Pro! 🎉</h1>
							</td>
						</tr>

						<!-- Main Content -->
						<tr>
							<td style="background-color: #f8f9fa; padding: 40px 30px; border-radius: 0 0 8px 8px;">
								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Hi there,
								</p>

								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Thank you for upgrading <strong>${escapedOrgName}</strong> to <strong>LLMGateway Pro</strong>!
									You now have access to all our premium
									features designed to give you more control, flexibility, and insights.
								</p>

								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Your trial will end on <strong>${formattedEndDate}</strong>. After that, you'll be charged for your
									Pro subscription unless you cancel before the trial ends.
								</p>

								<h2 style="margin: 30px 0 20px 0; font-size: 20px; font-weight: 600; color: #000000;">Your Pro
									Features:</h2>

								<table role="presentation" style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
									<tr>
										<td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
											<span style="color: #000000; font-size: 18px; margin-right: 10px;">✓</span>
											<span
												style="font-size: 16px; color: #333333;"
											>Provider API key management (bring your own keys)</span>
										</td>
									</tr>
									<tr>
										<td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
											<span style="color: #000000; font-size: 18px; margin-right: 10px;">✓</span>
											<span style="font-size: 16px; color: #333333;">No fees on credit top-ups</span>
										</td>
									</tr>
									<tr>
										<td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
											<span style="color: #000000; font-size: 18px; margin-right: 10px;">✓</span>
											<span style="font-size: 16px; color: #333333;">Extended data retention (90 days)</span>
										</td>
									</tr>
									<tr>
										<td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
											<span style="color: #000000; font-size: 18px; margin-right: 10px;">✓</span>
											<span style="font-size: 16px; color: #333333;">Team management</span>
										</td>
									</tr>
									<tr>
										<td style="padding: 12px 0; border-bottom: 1px solid #e5e7eb;">
											<span style="color: #000000; font-size: 18px; margin-right: 10px;">✓</span>
											<span style="font-size: 16px; color: #333333;">Advanced analytics and insights</span>
										</td>
									</tr>
									<tr>
										<td style="padding: 12px 0;">
											<span style="color: #000000; font-size: 18px; margin-right: 10px;">✓</span>
											<span style="font-size: 16px; color: #333333;">Priority support</span>
										</td>
									</tr>
								</table>

								<p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Ready to explore? Head to your dashboard to start using your new Pro features.
								</p>

								<!-- CTA Button -->
								<table role="presentation" style="width: 100%; border-collapse: collapse;">
									<tr>
										<td align="center" style="padding: 10px 0;">
											<a
												href="https://llmgateway.io/dashboard"
												style="display: inline-block; background-color: #000000; color: #ffffff; padding: 14px 40px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;"
											>Go to Dashboard</a>
										</td>
									</tr>
								</table>

								<p style="margin: 30px 0 0 0; font-size: 14px; line-height: 1.6; color: #666666;">
									If you have any questions or need help getting started, our priority support team is here for you.
									Just reply to this email!
								</p>
							</td>
						</tr>

						<!-- Footer -->
						<tr>
							<td
								style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;"
							>
								<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
									Need help getting started? Check out our <a
									href="https://docs.llmgateway.io" style="color: #000000; text-decoration: none;"
								>documentation</a> or reply to this email for any questions.
								</p>
								<p style="margin: 0; color: #999999; font-size: 12px;">
									© 2025 LLM Gateway. All rights reserved. This is a transactional email and it can't be unsubscribed from.
								</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
	`.trim();
}

export function generateSubscriptionCancelledEmailHtml(
	organizationName: string,
): string {
	return `
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Subscription Cancelled - LLMGateway</title>
	</head>
	<body
		style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #ffffff;"
	>
		<table role="presentation" style="width: 100%; border-collapse: collapse;">
			<tr>
				<td align="center" style="padding: 40px 20px;">
					<table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse;">

						<!-- Main Content -->
						<tr>
							<td style="padding: 0;">
								<div style="background-color: #f8f9fa; border-radius: 8px; padding: 30px; margin-bottom: 20px;">
									<h1 style="color: #dc2626; margin-top: 0; font-size: 24px; font-weight: 600;">Your Subscription Has
										Been Cancelled</h1>

									<p style="font-size: 16px; margin-bottom: 20px; color: #333; line-height: 1.5;">
										Hi there,
									</p>

									<p style="font-size: 16px; margin-bottom: 20px; color: #333; line-height: 1.5;">
										We're sorry to see you go. Your Pro subscription for
										<strong>${escapeHtml(organizationName)}</strong> has been cancelled and your organization has been
										downgraded to the free plan.
									</p>

									<p style="font-size: 16px; margin-bottom: 20px; color: #333; line-height: 1.5;">
										You can continue using LLMGateway with our free plan features, or you can resubscribe to Pro at any
										time from your dashboard.
									</p>

									<!-- CTA Button -->
									<div style="text-align: center; margin: 30px 0;">
										<a
											href="https://llmgateway.io/dashboard/settings/org/billing"
											style="display: inline-block; background-color: #000000; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;"
										>Manage Subscription</a>
									</div>

									<p style="font-size: 14px; color: #646464; margin-top: 30px; margin-bottom: 0; line-height: 1.5;">
										We'd love to hear your feedback! Reply to this email and let us know why you cancelled or how we can
										improve.
									</p>
								</div>

								<!-- Footer -->
								<tr>
									<td
										style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;"
									>
										<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
											Need help getting started? Check out our <a
											href="https://docs.llmgateway.io" style="color: #000000; text-decoration: none;"
										>documentation</a> or reply to this email for any questions.
										</p>
										<p style="margin: 0; color: #999999; font-size: 12px;">
											© 2025 LLM Gateway. All rights reserved. This is a transactional email and it can't be unsubscribed from.
										</p>
									</td>
								</tr>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
	`.trim();
}
