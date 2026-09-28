import { renderDocument } from "@formepdf/core";
import {
	Cell,
	Document,
	Fixed,
	Page,
	Row,
	Table,
	Text,
	View,
} from "@formepdf/react";

import type { InvoiceData } from "@/utils/invoice.js";
import type { Style } from "@formepdf/react";

interface InvoiceDocumentProps {
	data: InvoiceData;
	from: string[];
}

const DOCUMENT_LABELS = {
	invoice: { title: "Invoice", number: "Invoice Number" },
	credit_note: { title: "Credit Note", number: "Credit Note Number" },
	receipt: { title: "Receipt", number: "Receipt Number" },
} as const;

const colors = {
	foreground: "#18181b",
	muted: "#71717a",
	border: "#e4e4e7",
	surface: "#f4f4f5",
};

const styles = {
	page: { fontFamily: "Helvetica", fontSize: 10, color: colors.foreground },
	title: { fontSize: 28, fontWeight: "bold", textTransform: "uppercase" },
	label: {
		color: colors.muted,
		fontSize: 8,
		fontWeight: "bold",
		letterSpacing: 0.8,
		marginBottom: 6,
		textTransform: "uppercase",
	},
	row: { flexDirection: "row", marginBottom: 28 },
	column: { flex: 1, paddingRight: 20 },
	line: { lineHeight: 1.6 },
	detail: { flexDirection: "row", paddingVertical: 3 },
	detailKey: { flex: 1, color: colors.muted },
	right: { textAlign: "right" },
	headerCell: {
		fontSize: 9,
		fontWeight: "bold",
		letterSpacing: 0.5,
		textTransform: "uppercase",
		paddingVertical: 4,
		paddingHorizontal: 8,
	},
	cell: {
		paddingVertical: 4,
		paddingHorizontal: 8,
		borderBottomWidth: 0.5,
		borderColor: colors.border,
	},
	total: {
		flexDirection: "row",
		width: 240,
		marginTop: 16,
		marginLeft: "auto",
		fontSize: 12,
		fontWeight: "bold",
	},
	vat: { color: colors.muted, fontSize: 9, fontStyle: "italic", marginTop: 28 },
	notes: {
		marginTop: 16,
		padding: 16,
		backgroundColor: colors.surface,
		borderLeftWidth: 4,
		borderColor: colors.foreground,
	},
	footer: { color: colors.muted, fontSize: 8, textAlign: "right" },
} satisfies Record<string, Style>;

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

function lines(value: string | null | undefined): string[] {
	return value ? value.split("\n") : [];
}

function renderLines(values: string[]) {
	return values.map((value, index) => (
		<Text key={index} style={styles.line}>
			{value}
		</Text>
	));
}

function InvoiceDocument({ data, from }: InvoiceDocumentProps) {
	const labels = DOCUMENT_LABELS[data.documentType ?? "invoice"];
	const money = (amount: number) => `${data.currency} ${amount.toFixed(2)}`;
	const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);

	const details = [
		[labels.number, data.invoiceNumber],
		["Date", formatDate(data.invoiceDate)],
	];
	if (
		data.documentType === "credit_note" &&
		data.originalAmount !== undefined
	) {
		details.push(["Original amount", money(data.originalAmount)]);
		if (data.refundPercentage !== undefined) {
			details.push([
				"Refunded",
				`${data.refundPercentage.toFixed(1)}% of original purchase`,
			]);
		}
	}

	const fromLines = [...from];
	if (data.merchantBrandName) {
		fromLines.push(`On behalf of: ${data.merchantBrandName}`);
	}
	if (data.merchantSupportEmail) {
		fromLines.push(`Support: ${data.merchantSupportEmail}`);
	}

	const billToLines = [
		...lines(data.billingCompany),
		data.organizationName,
		data.billingEmail,
		...lines(data.billingAddress),
	];
	if (data.billingTaxId) {
		billToLines.push(`Tax ID: ${data.billingTaxId}`);
	}

	return (
		<Document title={`${labels.title} ${data.invoiceNumber}`} lang="en-US">
			<Page size="A4" margin={56} style={styles.page}>
				<Fixed position="footer">
					<Text style={styles.footer}>
						{"Page {{pageNumber}} of {{totalPages}}"}
					</Text>
				</Fixed>
				<View style={styles.row} wrap={false}>
					<Text style={{ ...styles.column, ...styles.title }}>
						{labels.title}
					</Text>
					<View style={{ width: 240 }}>
						{details.map(([key, value]) => (
							<View key={key} style={styles.detail}>
								<Text style={styles.detailKey}>{key}</Text>
								<Text style={styles.right}>{value}</Text>
							</View>
						))}
					</View>
				</View>
				<View style={styles.row} wrap={false}>
					<View style={styles.column}>
						<Text style={styles.label}>From</Text>
						{renderLines(fromLines)}
					</View>
					<View style={styles.column}>
						<Text style={styles.label}>Bill To</Text>
						{renderLines(billToLines)}
					</View>
				</View>
				<Table>
					<Row header style={{ backgroundColor: colors.surface }}>
						<Cell style={{ ...styles.headerCell, flex: 1 }}>
							<Text>Description</Text>
						</Cell>
						<Cell style={{ ...styles.headerCell, width: 120 }}>
							<Text style={styles.right}>Amount</Text>
						</Cell>
					</Row>
					{data.lineItems.map((item, index) => (
						<Row key={index}>
							<Cell style={{ ...styles.cell, flex: 1 }}>
								<Text>{item.description}</Text>
							</Cell>
							<Cell style={{ ...styles.cell, width: 120 }}>
								<Text style={styles.right}>{money(item.amount)}</Text>
							</Cell>
						</Row>
					))}
				</Table>
				<View style={styles.total} wrap={false}>
					<Text style={{ flex: 1 }}>Total</Text>
					<Text>{money(total)}</Text>
				</View>
				<Text style={styles.vat}>
					If applicable, customer should account for the respective VAT reverse
					charge.
				</Text>
				{data.billingNotes ? (
					<View style={styles.notes} wrap={false}>
						<Text style={styles.label}>Notes</Text>
						{renderLines(lines(data.billingNotes))}
					</View>
				) : null}
			</Page>
		</Document>
	);
}

export async function renderInvoicePdf(
	props: InvoiceDocumentProps,
): Promise<Buffer> {
	return Buffer.from(await renderDocument(<InvoiceDocument {...props} />));
}
