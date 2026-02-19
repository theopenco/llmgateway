import { Resend } from "resend";

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

const resendApiKey = process.env.RESEND_API_KEY;
const fromEmail =
	process.env.RESEND_FROM_EMAIL || "LLMGateway <contact@mail.llmgateway.io>";
const replyToEmail =
	process.env.RESEND_REPLY_TO_EMAIL || "contact@llmgateway.io";

let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
	if (!resendApiKey) {
		return null;
	}
	if (!resendClient) {
		resendClient = new Resend(resendApiKey);
	}
	return resendClient;
}

export interface TransactionalEmailOptions {
	to: string;
	subject: string;
	html?: string;
	text?: string;
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
	text,
	attachments,
}: TransactionalEmailOptions): Promise<void> {
	// In non-production environments, just log the email content
	if (process.env.NODE_ENV !== "production") {
		logger.info("Email content (not sent in non-production)", {
			to,
			subject,
			html,
			text,
			attachments: attachments?.map((a) => ({
				filename: a.filename,
				size: a.content.length,
			})),
			from: fromEmail,
			replyTo: replyToEmail,
		});
		return;
	}

	const client = getResendClient();
	if (!client) {
		logger.error(
			"RESEND_API_KEY is not configured. Transactional email will not be sent.",
			new Error(
				`Resend not configured for email to ${to} with subject: ${subject}`,
			),
		);
		return;
	}

	try {
		const emailPayload = {
			from: fromEmail,
			to: [to],
			replyTo: replyToEmail,
			subject,
			attachments: attachments?.map((att) => ({
				filename: att.filename,
				content: att.content,
				contentType: att.contentType,
			})),
		};

		const { data, error } = await client.emails.send(
			text ? { ...emailPayload, text } : { ...emailPayload, html: html ?? "" },
		);

		if (error) {
			throw new Error(`Resend API error: ${error.message}`);
		}

		logger.info("Transactional email sent successfully", {
			to,
			subject,
			hasAttachments: !!attachments?.length,
			messageId: data?.id,
		});
	} catch (error) {
		logger.error(
			"Failed to send transactional email",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}

export interface PaymentFailureDetails {
	errorMessage: string;
	errorCode?: string;
	declineCode?: string;
	amount?: number;
	currency?: string;
}

export function generatePaymentFailureEmailHtml(
	organizationName: string,
	details: PaymentFailureDetails,
): string {
	const escapedOrgName = escapeHtml(organizationName);
	const escapedErrorMessage = escapeHtml(details.errorMessage);

	// Escape currency and handle zero amount case properly
	const escapedCurrency = details.currency
		? escapeHtml(details.currency)
		: null;
	const formattedAmount =
		details.amount !== undefined && details.amount !== null && escapedCurrency
			? `${escapedCurrency} ${details.amount.toFixed(2)}`
			: null;

	let actionMessage = "Please update your payment method and try again.";
	if (details.declineCode === "insufficient_funds") {
		actionMessage =
			"Please ensure your card has sufficient funds or use a different payment method.";
	} else if (
		details.declineCode === "expired_card" ||
		details.errorCode === "expired_card"
	) {
		actionMessage = "Your card has expired. Please update your payment method.";
	} else if (
		details.declineCode === "lost_card" ||
		details.declineCode === "stolen_card"
	) {
		actionMessage =
			"This card cannot be used. Please add a different payment method.";
	}

	return `
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Payment Failed - LLMGateway</title>
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
								style="background-color: #dc2626; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;"
							>
								<h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Payment Failed</h1>
							</td>
						</tr>

						<!-- Main Content -->
						<tr>
							<td style="background-color: #f8f9fa; padding: 40px 30px; border-radius: 0 0 8px 8px;">
								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Hi there,
								</p>

								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									We were unable to process a payment for <strong>${escapedOrgName}</strong>.
								</p>

								<!-- Error Details Box -->
								<div
									style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 20px; margin-bottom: 20px;"
								>
									<p style="margin: 0 0 10px 0; font-size: 14px; font-weight: 600; color: #991b1b;">
										Error Details:
									</p>
									<p style="margin: 0; font-size: 14px; color: #7f1d1d;">
										${escapedErrorMessage}
									</p>
									${formattedAmount ? `<p style="margin: 10px 0 0 0; font-size: 14px; color: #7f1d1d;">Amount: ${formattedAmount}</p>` : ""}
								</div>

								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									${escapeHtml(actionMessage)}
								</p>

								<p style="margin: 0 0 30px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									To ensure uninterrupted service, please update your payment information as soon as possible.
								</p>

								<!-- CTA Button -->
								<table role="presentation" style="width: 100%; border-collapse: collapse;">
									<tr>
										<td align="center" style="padding: 10px 0;">
											<a
												href="https://llmgateway.io/dashboard/settings/org/billing"
												style="display: inline-block; background-color: #000000; color: #ffffff; padding: 14px 40px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px;"
											>Update Payment Method</a>
										</td>
									</tr>
								</table>

								<p style="margin: 30px 0 0 0; font-size: 14px; line-height: 1.6; color: #666666;">
									If you believe this is an error or need assistance, please reply to this email and we'll be happy to
									help.
								</p>
							</td>
						</tr>

						<!-- Footer -->
						<tr>
							<td
								style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;"
							>
								<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
									Need help? Check out our <a
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
