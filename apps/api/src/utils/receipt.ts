import { logger } from "@llmgateway/logger";
import { formatStatementDescriptor } from "@llmgateway/shared";

import { sendTransactionalEmail } from "./email.js";
import { escapeHtml, generateInvoicePDF } from "./invoice.js";

import type { InvoiceDocumentType, InvoiceLineItem } from "./invoice.js";

const SUPPORT_EMAIL = "contact@llmgateway.io";

export interface ReceiptEmailInput {
	// Null/empty when we never captured an address for the payer — the receipt
	// is skipped rather than failing the surrounding webhook.
	to: string | null;
	recipientName: string | null;
	subject: string;
	receiptNumber: string;
	date: Date;
	lineItems: InvoiceLineItem[];
	currency: string;
	// Defaults to "receipt"; "credit_note" for refunds.
	documentType?: InvoiceDocumentType;
	// Payments SDK only: the developer whose product the payer actually used.
	// LLM Gateway stays merchant of record either way.
	merchantBrandName?: string | null;
	merchantSupportEmail?: string | null;
	// The project's configured suffix, so the email quotes the same descriptor
	// the cardholder will actually see. Only rendered alongside the
	// merchant-of-record notice below.
	statementDescriptorSuffix?: string | null;
	// Payments SDK only. The payer bought from the developer, not from us, so
	// the receipt has to explain who actually took their money and what the
	// charge is called on their statement. A direct LLM Gateway purchase — org
	// credits, DevPass, Chat plans, the Airside listing fee — needs no such
	// explanation, and saying it there only invites the question.
	merchantOfRecordNotice?: boolean;
}

/**
 * Receipt for a payer who is not an organization member — a Payments SDK
 * end-user or an Airside carrier. Unlike `generateAndEmailInvoice` this never
 * passes `organizationId`, because that gates delivery on the *organization
 * owner's* verified email, which has nothing to do with whether this payer
 * should get proof of their own payment.
 *
 * Never throws: every caller is a Stripe webhook handler where the money work
 * has already committed, and a failed email must not trigger a webhook retry.
 */
export async function sendReceiptEmail(
	input: ReceiptEmailInput,
): Promise<void> {
	const {
		to,
		recipientName,
		subject,
		receiptNumber,
		date,
		lineItems,
		currency,
		documentType = "receipt",
		merchantBrandName,
		merchantSupportEmail,
		statementDescriptorSuffix,
		merchantOfRecordNotice = false,
	} = input;

	try {
		if (!to?.trim()) {
			logger.info("Skipping receipt email: no recipient address", {
				receiptNumber,
			});
			return;
		}

		const total = lineItems.reduce((sum, item) => sum + item.amount, 0);
		if (total === 0) {
			logger.info("Skipping receipt email for zero amount", { receiptNumber });
			return;
		}

		const isCreditNote = documentType === "credit_note";

		const pdfBuffer = generateInvoicePDF({
			invoiceNumber: receiptNumber,
			invoiceDate: date,
			// The payer, not an organization — this lands in the PDF's BILL TO block.
			organizationName: recipientName ?? to,
			billingEmail: to,
			lineItems,
			currency,
			documentType,
			merchantBrandName,
			merchantSupportEmail,
		});

		const escapedNumber = escapeHtml(receiptNumber);
		const escapedCurrency = escapeHtml(currency);
		const escapedBrand = merchantBrandName
			? escapeHtml(merchantBrandName)
			: null;
		const escapedMerchantSupport = merchantSupportEmail
			? escapeHtml(merchantSupportEmail)
			: null;
		const escapedDescriptor = escapeHtml(
			formatStatementDescriptor(statementDescriptorSuffix ?? null),
		);
		const billingBlock = merchantOfRecordNotice
			? `This payment was processed by LLM Gateway, the merchant of record. It appears on your statement as <strong>${escapedDescriptor}</strong>. For billing enquiries contact <a href="mailto:${SUPPORT_EMAIL}" style="color: #000000; text-decoration: none;">${SUPPORT_EMAIL}</a>`
			: `For billing enquiries contact <a href="mailto:${SUPPORT_EMAIL}" style="color: #000000; text-decoration: none;">${SUPPORT_EMAIL}</a>`;
		const documentLabel = isCreditNote ? "Credit note" : "Receipt";
		const filenamePrefix = isCreditNote ? "credit-note" : "receipt";

		const intro = isCreditNote
			? "Your refund has been processed."
			: "Thank you for your payment!";

		// The developer's support address is the one the payer recognises, so it
		// leads. Ours stays below it — we are the merchant of record and have to
		// be reachable on the document.
		const supportBlock = escapedMerchantSupport
			? `<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
									Questions about this purchase? Contact ${escapedBrand ?? "the seller"} at <a href="mailto:${escapedMerchantSupport}" style="color: #000000; text-decoration: none;">${escapedMerchantSupport}</a>
								</p>`
			: "";

		await sendTransactionalEmail({
			to,
			subject,
			attachments: [
				{
					filename: `${filenamePrefix}-${escapedNumber}.pdf`,
					content: pdfBuffer,
					contentType: "application/pdf",
				},
			],
			html: `
<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="UTF-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>${documentLabel} ${escapedNumber}</title>
	</head>
	<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #ffffff;">
		<table role="presentation" style="width: 100%; border-collapse: collapse;">
			<tr>
				<td align="center" style="padding: 40px 20px;">
					<table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse;">
						<tr>
							<td style="background-color: #000000; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
								<h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">${escapedBrand ?? "LLM Gateway"}</h1>
								<p style="margin: 8px 0 0; color: #cccccc; font-size: 14px;">${documentLabel} ${escapedNumber}</p>
							</td>
						</tr>
						<tr>
							<td style="background-color: #f8f9fa; padding: 40px 30px;">
								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									${intro}
								</p>
								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									A copy of your ${documentLabel.toLowerCase()} is attached to this email.
								</p>
								<p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #666666;">
									<strong>${documentLabel} number:</strong> ${escapedNumber}<br>
									<strong>Date:</strong> ${date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}<br>
									<strong>Total:</strong> ${escapedCurrency} ${total.toFixed(2)}
								</p>
							</td>
						</tr>
						<tr>
							<td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
								${supportBlock}
								<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
									${billingBlock}
								</p>
								<p style="margin: 0; color: #999999; font-size: 12px;">
									You are receiving this because a payment was made with this email address.
								</p>
							</td>
						</tr>
					</table>
				</td>
			</tr>
		</table>
	</body>
</html>
			`.trim(),
		});

		logger.info("Receipt emailed successfully", { receiptNumber, to });
	} catch (error) {
		logger.error(
			"Failed to generate or email receipt",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}
