import { jsPDF } from "jspdf";

import { logger } from "@llmgateway/logger";

import { sendTransactionalEmail } from "./email.js";

const invoiceFrom = process.env.INVOICE_FROM || "Fake Company\\nUnited States";

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

export interface InvoiceData {
	invoiceNumber: string;
	invoiceDate: Date;
	organizationName: string;
	billingEmail: string;
	billingCompany?: string | null;
	billingAddress?: string | null;
	billingTaxId?: string | null;
	billingNotes?: string | null;
	lineItems: InvoiceLineItem[];
	currency: string;
}

export function generateInvoicePDF(data: InvoiceData): Buffer {
	// Validate required fields
	if (!data.lineItems || data.lineItems.length === 0) {
		throw new Error("Invoice must contain at least one line item");
	}
	if (data.lineItems.some((item) => item.amount < 0)) {
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
	doc.text("INVOICE", pageWidth / 2, yPos, { align: "center" });

	yPos += 15;
	doc.setFontSize(10);
	doc.setFont("helvetica", "normal");
	doc.text(`Invoice Number: ${invoiceNumber}`, 20, yPos);
	yPos += 6;
	doc.text(
		`Date: ${data.invoiceDate.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
		20,
		yPos,
	);

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
	doc.text("BILL TO:", pageWidth / 2 + 10, yPos);
	yPos += 7;
	doc.setFontSize(10);
	doc.setFont("helvetica", "normal");

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
