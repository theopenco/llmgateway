import { jsPDF } from "jspdf";

import { logger } from "@llmgateway/logger";

import { sendTransactionalEmail } from "./email.js";

const invoiceFrom = process.env.INVOICE_FROM ?? "Fake Company\\nUnited States";

function escapeHtml(unsafe: string): string {
	return unsafe
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

export interface InvoiceLineItem {
	description: string;
	amount: number;
}

// "invoice" for a charge, "credit_note" for a refund. A credit note renders the
// same layout but titled as a refund document.
export type InvoiceDocumentType = "invoice" | "credit_note";

export interface InvoiceData {
	invoiceNumber: string;
	invoiceDate: Date;
	organizationName: string;
	// Organization the invoice belongs to. Used to gate delivery on the owner's
	// verified email; see sendTransactionalEmail.
	organizationId: string;
	billingEmail: string;
	billingCompany?: string | null;
	billingAddress?: string | null;
	billingTaxId?: string | null;
	billingNotes?: string | null;
	lineItems: InvoiceLineItem[];
	currency: string;
	// Defaults to "invoice" when omitted.
	documentType?: InvoiceDocumentType;
	// Credit-note context: the full amount of the original purchase and the
	// percentage of it that this refund covers. Shown above the line items.
	originalAmount?: number;
	refundPercentage?: number;
}

// Human-readable fallback labels used when a transaction has no stored
// description. Covers the charge and refund types that are invoiceable (see
// isInvoiceableTransaction).
const TRANSACTION_TYPE_LABELS: Record<string, string> = {
	credit_topup: "Credit Top-up",
	subscription_start: "Subscription",
	dev_plan_start: "DevPass Plan",
	dev_plan_renewal: "DevPass Plan Renewal",
	dev_plan_upgrade: "DevPass Plan Upgrade",
	chat_plan_start: "Chat Plan",
	chat_plan_renewal: "Chat Plan Renewal",
	chat_plan_upgrade: "Chat Plan Upgrade",
	end_user_topup: "Credit Top-up",
	credit_refund: "Refund",
	end_user_refund: "Refund",
};

// Refund transactions record the returned amount as a positive `amount` (see
// stripe.ts); they render as a credit note rather than an invoice.
export function isRefundTransaction(type: string): boolean {
	return type === "credit_refund" || type === "end_user_refund";
}

interface InvoiceableTransaction {
	id: string;
	type: string;
	amount: string | null;
	currency: string;
	description: string | null;
	createdAt: Date;
	status: string;
	relatedTransactionId?: string | null;
}

// The original purchase a refund relates to (via relatedTransactionId). Used to
// show the initial full amount and the refunded percentage on the credit note.
interface OriginalTransaction {
	amount: string | null;
	description: string | null;
}

interface InvoiceOrganization {
	id: string;
	name: string;
	billingEmail: string;
	billingCompany: string | null;
	billingAddress: string | null;
	billingTaxId: string | null;
	billingNotes: string | null;
}

// A transaction has a downloadable document when it is completed with a
// positive amount: a charge (top-ups, subscription/plan starts, renewals and
// upgrades) yields an invoice, a refund (positive `amount`, see stripe.ts)
// yields a credit note. Cancels, ends and zero/no-amount gifts are excluded —
// there is nothing to document for those.
export function isInvoiceableTransaction(transaction: {
	status: string;
	amount: string | null;
}): boolean {
	return (
		transaction.status === "completed" &&
		transaction.amount !== null &&
		parseFloat(transaction.amount) > 0
	);
}

// Reconstruct the InvoiceData for an existing purchase transaction so it can be
// re-rendered on demand (e.g. a downloadable PDF). The invoice number and date
// mirror the invoice originally emailed at purchase time (see stripe.ts).
export function buildInvoiceDataForTransaction(
	transaction: InvoiceableTransaction,
	organization: InvoiceOrganization,
	originalTransaction?: OriginalTransaction | null,
): InvoiceData {
	const amount = transaction.amount ? parseFloat(transaction.amount) : 0;

	const base = {
		invoiceNumber: transaction.id,
		invoiceDate: transaction.createdAt,
		organizationName: organization.name,
		organizationId: organization.id,
		billingEmail: organization.billingEmail,
		billingCompany: organization.billingCompany,
		billingAddress: organization.billingAddress,
		billingTaxId: organization.billingTaxId,
		billingNotes: organization.billingNotes,
		currency: transaction.currency,
	};

	if (isRefundTransaction(transaction.type)) {
		// Refunds record a positive `amount` (see stripe.ts); the credit note
		// shows it as a negative net total and, when the original purchase is
		// known, the full initial amount and the refunded percentage.
		const originalAmountRaw = originalTransaction?.amount;
		const originalAmount =
			originalAmountRaw !== null && originalAmountRaw !== undefined
				? parseFloat(originalAmountRaw)
				: null;
		const refundPercentage =
			originalAmount && originalAmount > 0
				? (amount / originalAmount) * 100
				: null;
		const lineDescription = originalTransaction?.description
			? `Refund — ${originalTransaction.description}`
			: (transaction.description ?? "Refund");

		return {
			...base,
			documentType: "credit_note",
			lineItems: [{ description: lineDescription, amount: -amount }],
			originalAmount: originalAmount ?? undefined,
			refundPercentage: refundPercentage ?? undefined,
		};
	}

	const description =
		transaction.description ??
		TRANSACTION_TYPE_LABELS[transaction.type] ??
		"Purchase";

	return {
		...base,
		documentType: "invoice",
		lineItems: [{ description, amount }],
	};
}

export function generateInvoicePDF(data: InvoiceData): Buffer {
	const isCreditNote = data.documentType === "credit_note";

	// Validate required fields
	if (!data.lineItems || data.lineItems.length === 0) {
		throw new Error("Invoice must contain at least one line item");
	}
	// Invoices bill for a charge (non-negative); credit notes record a refund as
	// a negative net amount, so negatives are expected there.
	if (!isCreditNote && data.lineItems.some((item) => item.amount < 0)) {
		throw new Error("Line item amounts must be non-negative");
	}

	// Use empty strings for optional fields if not provided
	const invoiceNumber = data.invoiceNumber || "";
	const organizationName = data.organizationName || "";
	const billingEmail = data.billingEmail || "";

	// eslint-disable-next-line new-cap
	const doc = new jsPDF();
	const pageWidth = doc.internal.pageSize.getWidth();
	let yPos = 20;

	doc.setFontSize(24);
	doc.setFont("helvetica", "bold");
	doc.text(isCreditNote ? "CREDIT NOTE" : "INVOICE", pageWidth / 2, yPos, {
		align: "center",
	});

	yPos += 15;
	doc.setFontSize(10);
	doc.setFont("helvetica", "normal");
	doc.text(
		`${isCreditNote ? "Credit Note" : "Invoice"} Number: ${invoiceNumber}`,
		20,
		yPos,
	);
	yPos += 6;
	doc.text(
		`Date: ${data.invoiceDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
		20,
		yPos,
	);

	// Credit-note context: the original purchase amount and the refunded portion.
	if (isCreditNote && data.originalAmount !== undefined) {
		yPos += 6;
		doc.text(
			`Original amount: ${data.currency} ${data.originalAmount.toFixed(2)}`,
			20,
			yPos,
		);
		if (data.refundPercentage !== undefined) {
			yPos += 6;
			doc.text(
				`Refunded: ${data.refundPercentage.toFixed(1)}% of original purchase`,
				20,
				yPos,
			);
		}
	}

	yPos += 15;
	const fromYPos = yPos;

	// Render FROM column (left side)
	doc.setFontSize(12);
	doc.setFont("helvetica", "bold");
	doc.text("FROM:", 20, yPos);
	yPos += 7;
	doc.setFontSize(10);
	doc.setFont("helvetica", "normal");

	const fromLines = invoiceFrom.replace(/\\n/g, "\n").split("\n");
	for (const line of fromLines) {
		doc.text(line, 20, yPos);
		yPos += 6;
	}
	const fromEndY = yPos;

	// Render BILL TO column (right side)
	yPos = fromYPos;
	doc.setFontSize(12);
	doc.setFont("helvetica", "bold");
	// eslint-disable-next-line no-mixed-operators
	doc.text("BILL TO:", pageWidth / 2 + 10, yPos);
	yPos += 7;
	doc.setFontSize(10);
	doc.setFont("helvetica", "normal");

	// eslint-disable-next-line no-mixed-operators
	const billToX = pageWidth / 2 + 10;

	if (data.billingCompany) {
		doc.text(data.billingCompany, billToX, yPos);
		yPos += 6;
	}

	doc.text(organizationName, billToX, yPos);
	yPos += 6;
	doc.text(billingEmail, billToX, yPos);
	yPos += 6;

	if (data.billingAddress) {
		const addressLines = data.billingAddress.split("\n");
		for (const line of addressLines) {
			doc.text(line, billToX, yPos);
			yPos += 6;
		}
	}

	if (data.billingTaxId) {
		doc.text(`Tax ID: ${data.billingTaxId}`, billToX, yPos);
		yPos += 6;
	}
	const billToEndY = yPos;

	// Set yPos to the bottom of the taller column
	yPos = Math.max(fromEndY, billToEndY);

	yPos += 10;
	doc.setFontSize(12);
	doc.setFont("helvetica", "bold");
	doc.text("DESCRIPTION", 20, yPos);
	doc.text("AMOUNT", pageWidth - 20, yPos, { align: "right" });
	yPos += 2;

	doc.setLineWidth(0.5);
	doc.line(20, yPos, pageWidth - 20, yPos);
	yPos += 8;

	doc.setFontSize(10);
	doc.setFont("helvetica", "normal");

	let total = 0;
	for (const item of data.lineItems) {
		doc.text(item.description, 20, yPos);
		doc.text(
			`${data.currency} ${item.amount.toFixed(2)}`,
			pageWidth - 20,
			yPos,
			{ align: "right" },
		);
		total += item.amount;
		yPos += 7;
	}

	yPos += 5;
	doc.setLineWidth(0.5);
	doc.line(20, yPos, pageWidth - 20, yPos);
	yPos += 8;

	doc.setFontSize(12);
	doc.setFont("helvetica", "bold");
	// total is negative for a credit note (net refund), e.g. "USD -50.00".
	doc.text("TOTAL", 20, yPos);
	doc.text(`${data.currency} ${total.toFixed(2)}`, pageWidth - 20, yPos, {
		align: "right",
	});

	yPos += 15;
	doc.setFontSize(9);
	doc.setFont("helvetica", "italic");
	doc.text(
		"If applicable, customer should account for the respective VAT reverse charge.",
		20,
		yPos,
	);

	if (data.billingNotes) {
		yPos += 20;
		doc.setFontSize(10);
		doc.setFont("helvetica", "normal");
		doc.text("Notes:", 20, yPos);
		yPos += 6;

		const notesLines = data.billingNotes.split("\n");
		for (const line of notesLines) {
			doc.text(line, 20, yPos);
			yPos += 6;
		}
	}

	const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
	return pdfBuffer;
}

export async function generateAndEmailInvoice(
	data: InvoiceData,
): Promise<void> {
	try {
		const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);

		if (total === 0) {
			logger.info("Skipping invoice email for zero amount", {
				invoiceNumber: data.invoiceNumber,
			});
			return;
		}

		const pdfBuffer = generateInvoicePDF(data);

		const escapedInvoiceNumber = escapeHtml(data.invoiceNumber);
		const escapedCurrency = escapeHtml(data.currency);

		await sendTransactionalEmail({
			to: data.billingEmail,
			organizationId: data.organizationId,
			subject: `Invoice ${escapedInvoiceNumber} - LLMGateway`,
			attachments: [
				{
					filename: `invoice-${escapedInvoiceNumber}.pdf`,
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
		<title>Invoice ${escapedInvoiceNumber}</title>
	</head>
	<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #ffffff;">
		<table role="presentation" style="width: 100%; border-collapse: collapse;">
			<tr>
				<td align="center" style="padding: 40px 20px;">
					<table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse;">
						<tr>
							<td style="background-color: #000000; padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
								<h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 600;">Invoice ${escapedInvoiceNumber}</h1>
							</td>
						</tr>
						<tr>
							<td style="background-color: #f8f9fa; padding: 40px 30px; border-radius: 0 0 8px 8px;">
								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Thank you for your payment!
								</p>
								<p style="margin: 0 0 20px 0; font-size: 16px; line-height: 1.6; color: #333333;">
									Please find your invoice attached to this email.
								</p>
								<p style="margin: 0 0 20px 0; font-size: 14px; line-height: 1.6; color: #666666;">
									<strong>Invoice Number:</strong> ${escapedInvoiceNumber}<br>
									<strong>Date:</strong> ${data.invoiceDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}<br>
									<strong>Total:</strong> ${escapedCurrency} ${data.lineItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2)}
								</p>
							</td>
						</tr>
						<tr>
							<td style="padding: 30px 40px; background-color: #f8f9fa; border-radius: 0 0 8px 8px; border-top: 1px solid #e9ecef;">
								<p style="margin: 0 0 12px; color: #666666; font-size: 14px; line-height: 1.6;">
									If you have any questions about this invoice, please contact us at <a href="mailto:contact@llmgateway.io" style="color: #000000; text-decoration: none;">contact@llmgateway.io</a>
								</p>
								<p style="margin: 0; color: #999999; font-size: 12px;">
									© 2025 LLM Gateway. All rights reserved.
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

		logger.info("Invoice generated and emailed successfully", {
			invoiceNumber: data.invoiceNumber,
			to: data.billingEmail,
		});
	} catch (error) {
		logger.error(
			"Failed to generate or email invoice",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
