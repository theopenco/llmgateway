import * as fs from "node:fs";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { generateAndEmailInvoice, generateInvoicePDF } from "./invoice.js";

import type { InvoiceData } from "./invoice.js";

vi.mock("./email.js", () => ({
	sendTransactionalEmail: vi.fn(),
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		error: vi.fn(),
	},
}));

describe("generateInvoicePDF", () => {
	const baseInvoiceData: InvoiceData = {
		invoiceNumber: "INV-2025-001",
		invoiceDate: new Date("2025-01-15"),
		organizationName: "Test Organization",
		billingEmail: "billing@example.com",
		lineItems: [
			{ description: "API Usage - January 2025", amount: 100.5 },
			{ description: "Premium Features", amount: 50.0 },
		],
		currency: "USD",
	};

	it("generates a PDF buffer with valid invoice data", () => {
		const pdfBuffer = generateInvoicePDF(baseInvoiceData);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);

		const pdfSignature = pdfBuffer.toString("ascii", 0, 4);
		expect(pdfSignature).toBe("%PDF");
	});

	it("includes all optional billing information when provided", () => {
		const dataWithOptionalFields: InvoiceData = {
			...baseInvoiceData,
			billingCompany: "Example Corp",
			billingAddress: "123 Main St\nSuite 100\nSan Francisco, CA 94105",
			billingTaxId: "TAX-123456",
			billingNotes: "Custom notes go here.",
		};

		const pdfBuffer = generateInvoicePDF(dataWithOptionalFields);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("Example Corp");
		expect(pdfContent).toContain("TAX-123456");
		expect(pdfContent).toContain("Notes:");

		const outputPath = path.join(process.cwd(), "example-invoice.pdf");
		fs.writeFileSync(outputPath, pdfBuffer);
		console.log(`Example PDF saved to: ${outputPath}`);
	});

	it("calculates total correctly from multiple line items", () => {
		const dataWithMultipleItems: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{ description: "Item 1", amount: 10.25 },
				{ description: "Item 2", amount: 20.5 },
				{ description: "Item 3", amount: 30.75 },
			],
		};

		const pdfBuffer = generateInvoicePDF(dataWithMultipleItems);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("61.50");
	});

	it("handles single line item", () => {
		const dataWithSingleItem: InvoiceData = {
			...baseInvoiceData,
			lineItems: [{ description: "Single Service", amount: 99.99 }],
		};

		const pdfBuffer = generateInvoicePDF(dataWithSingleItem);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("Single Service");
		expect(pdfContent).toContain("99.99");
	});

	it("handles different currencies", () => {
		const eurInvoice: InvoiceData = {
			...baseInvoiceData,
			currency: "EUR",
		};

		const pdfBuffer = generateInvoicePDF(eurInvoice);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("EUR");
	});

	it("formats amounts with two decimal places", () => {
		const dataWithDecimals: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{ description: "Item with decimals", amount: 10.1 },
				{ description: "Item without decimals", amount: 20 },
			],
		};

		const pdfBuffer = generateInvoicePDF(dataWithDecimals);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("10.10");
		expect(pdfContent).toContain("20.00");
		expect(pdfContent).toContain("30.10");
	});

	it("handles multiline addresses correctly", () => {
		const dataWithMultilineAddress: InvoiceData = {
			...baseInvoiceData,
			billingAddress: "Line 1\nLine 2\nLine 3\nLine 4",
		};

		const pdfBuffer = generateInvoicePDF(dataWithMultilineAddress);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);
	});

	it("handles multiline notes correctly", () => {
		const dataWithMultilineNotes: InvoiceData = {
			...baseInvoiceData,
			billingNotes: "Note line 1\nNote line 2\nNote line 3",
		};

		const pdfBuffer = generateInvoicePDF(dataWithMultilineNotes);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);
	});

	it("throws error when lineItems array is empty", () => {
		const invalidData: InvoiceData = {
			...baseInvoiceData,
			lineItems: [],
		};

		expect(() => generateInvoicePDF(invalidData)).toThrow(
			"Invoice must contain at least one line item",
		);
	});

	it("throws error when lineItems is missing", () => {
		const invalidData = {
			...baseInvoiceData,
			lineItems: undefined,
		} as unknown as InvoiceData;

		expect(() => generateInvoicePDF(invalidData)).toThrow(
			"Invoice must contain at least one line item",
		);
	});

	it("throws error when line item has negative amount", () => {
		const invalidData: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{ description: "Valid item", amount: 100 },
				{ description: "Invalid item", amount: -50 },
			],
		};

		expect(() => generateInvoicePDF(invalidData)).toThrow(
			"Line item amounts must be non-negative",
		);
	});

	it("accepts zero amount line items", () => {
		const dataWithZeroAmount: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{ description: "Free item", amount: 0 },
				{ description: "Paid item", amount: 50 },
			],
		};

		const pdfBuffer = generateInvoicePDF(dataWithZeroAmount);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("0.00");
		expect(pdfContent).toContain("50.00");
	});

	it("handles missing optional fields gracefully", () => {
		const minimalData: InvoiceData = {
			invoiceNumber: "INV-MIN-001",
			invoiceDate: new Date("2025-01-01"),
			organizationName: "Minimal Org",
			billingEmail: "min@example.com",
			lineItems: [{ description: "Service", amount: 100 }],
			currency: "USD",
		};

		const pdfBuffer = generateInvoicePDF(minimalData);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);
	});

	it("handles empty string optional fields", () => {
		const dataWithEmptyStrings: InvoiceData = {
			...baseInvoiceData,
			billingCompany: "",
			billingAddress: "",
			billingTaxId: "",
			billingNotes: "",
		};

		const pdfBuffer = generateInvoicePDF(dataWithEmptyStrings);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);
	});

	it("formats invoice date correctly", () => {
		const dataWithSpecificDate: InvoiceData = {
			...baseInvoiceData,
			invoiceDate: new Date("2025-03-15"),
		};

		const pdfBuffer = generateInvoicePDF(dataWithSpecificDate);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("March 15, 2025");
	});

	it("includes invoice header information", () => {
		const pdfBuffer = generateInvoicePDF(baseInvoiceData);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("INVOICE");
		expect(pdfContent).toContain("INV-2025-001");
		expect(pdfContent).toContain("Test Organization");
		expect(pdfContent).toContain("billing@example.com");
	});

	it("includes FROM section with default company information", () => {
		const pdfBuffer = generateInvoicePDF(baseInvoiceData);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("FROM:");
		expect(pdfContent).toContain("Fake Company");
		expect(pdfContent).toContain("United States");
	});

	it("includes VAT reverse charge note", () => {
		const pdfBuffer = generateInvoicePDF(baseInvoiceData);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain(
			"If applicable, customer should account for the respective VAT reverse charge.",
		);
	});

	it("includes line item descriptions and amounts", () => {
		const pdfBuffer = generateInvoicePDF(baseInvoiceData);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("API Usage - January 2025");
		expect(pdfContent).toContain("Premium Features");
		expect(pdfContent).toContain("100.50");
		expect(pdfContent).toContain("50.00");
	});

	it("includes total amount", () => {
		const pdfBuffer = generateInvoicePDF(baseInvoiceData);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("TOTAL");
		expect(pdfContent).toContain("150.50");
	});

	it("handles very long descriptions", () => {
		const dataWithLongDescription: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{
					description:
						"This is a very long description that might wrap to multiple lines in the PDF document and we want to ensure it's handled correctly",
					amount: 100,
				},
			],
		};

		const pdfBuffer = generateInvoicePDF(dataWithLongDescription);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);
	});

	it("handles large amounts correctly", () => {
		const dataWithLargeAmounts: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{ description: "Large service", amount: 999999.99 },
				{ description: "Another service", amount: 1000000.0 },
			],
		};

		const pdfBuffer = generateInvoicePDF(dataWithLargeAmounts);
		const pdfContent = pdfBuffer.toString("latin1");

		expect(pdfContent).toContain("999999.99");
		expect(pdfContent).toContain("1000000.00");
	});

	it("handles many line items", () => {
		const manyItems = Array.from({ length: 20 }, (_, i) => ({
			description: `Item ${i + 1}`,
			amount: (i + 1) * 10,
		}));

		const dataWithManyItems: InvoiceData = {
			...baseInvoiceData,
			lineItems: manyItems,
		};

		const pdfBuffer = generateInvoicePDF(dataWithManyItems);

		expect(pdfBuffer).toBeInstanceOf(Buffer);
		expect(pdfBuffer.length).toBeGreaterThan(0);
	});
});

describe("generateAndEmailInvoice", () => {
	const baseInvoiceData: InvoiceData = {
		invoiceNumber: "INV-2025-001",
		invoiceDate: new Date("2025-01-15"),
		organizationName: "Test Organization",
		billingEmail: "billing@example.com",
		lineItems: [
			{ description: "API Usage - January 2025", amount: 100.5 },
			{ description: "Premium Features", amount: 50.0 },
		],
		currency: "USD",
	};

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should not send email when total amount is 0", async () => {
		const { sendTransactionalEmail } = await import("./email.js");
		const { logger } = await import("@llmgateway/logger");

		const zeroAmountData: InvoiceData = {
			...baseInvoiceData,
			lineItems: [
				{ description: "Free item 1", amount: 0 },
				{ description: "Free item 2", amount: 0 },
			],
		};

		await generateAndEmailInvoice(zeroAmountData);

		expect(sendTransactionalEmail).not.toHaveBeenCalled();
		expect(logger.info).toHaveBeenCalledWith(
			"Skipping invoice email for zero amount",
			{
				invoiceNumber: "INV-2025-001",
			},
		);
	});

	it("should send email when total amount is greater than 0", async () => {
		const { sendTransactionalEmail } = await import("./email.js");

		await generateAndEmailInvoice(baseInvoiceData);

		expect(sendTransactionalEmail).toHaveBeenCalledOnce();
		expect(sendTransactionalEmail).toHaveBeenCalledWith(
			expect.objectContaining({
				to: "billing@example.com",
				subject: "Invoice INV-2025-001 - LLMGateway",
				attachments: expect.arrayContaining([
					expect.objectContaining({
						filename: "invoice-INV-2025-001.pdf",
						contentType: "application/pdf",
					}),
				]),
			}),
		);
	});
});
