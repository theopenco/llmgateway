import { renderDocument } from "@formepdf/core";
import { Document, Page } from "@formepdf/react";

import { KeyValue } from "./components/key-value.js";
import { Section } from "./components/section.js";
import {
	Table,
	TableBody,
	TableCell,
	TableHeader,
	TableRow,
} from "./components/table/table.js";
import { Text } from "./components/text.js";
import { StyleSheet, View } from "./primitives.js";
import { PdfcnThemeProvider, usePdfcnTheme } from "./theme-provider.js";

import type { InvoiceData } from "@/utils/invoice.js";

interface InvoiceDocumentProps {
	data: InvoiceData;
	from: string[];
}

const DOCUMENT_LABELS = {
	invoice: { title: "Invoice", number: "Invoice Number" },
	credit_note: { title: "Credit Note", number: "Credit Note Number" },
	receipt: { title: "Receipt", number: "Receipt Number" },
} as const;

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

const InvoiceContent = ({ data, from }: InvoiceDocumentProps) => {
	const theme = usePdfcnTheme();
	const labels = DOCUMENT_LABELS[data.documentType ?? "invoice"];
	const money = (amount: number) => `${data.currency} ${amount.toFixed(2)}`;
	const total = data.lineItems.reduce((sum, item) => sum + item.amount, 0);

	const styles = StyleSheet.create({
		label: {
			color: theme.colors.mutedForeground,
			fontSize: 8,
			fontWeight: "bold",
			letterSpacing: 0.8,
			marginBottom: 6,
			textTransform: "uppercase",
		},
		column: { flex: 1, paddingRight: 20 },
	});

	const details = [
		{ key: labels.number, value: data.invoiceNumber },
		{ key: "Date", value: formatDate(data.invoiceDate) },
	];
	if (
		data.documentType === "credit_note" &&
		data.originalAmount !== undefined
	) {
		details.push({
			key: "Original amount",
			value: money(data.originalAmount),
		});
		if (data.refundPercentage !== undefined) {
			details.push({
				key: "Refunded",
				value: `${data.refundPercentage.toFixed(1)}% of original purchase`,
			});
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
			<Page size="A4" margin={56}>
				<Section
					noWrap
					spacing="none"
					style={{
						alignItems: "flex-start",
						flexDirection: "row",
						marginBottom: theme.spacing.sectionGap,
					}}
				>
					<View style={{ flex: 1 }}>
						<Text variant="2xl" weight="bold" transform="uppercase" noMargin>
							{labels.title}
						</Text>
					</View>
					<View style={{ width: 240 }}>
						<KeyValue size="sm" items={details} />
					</View>
				</Section>
				<Section
					noWrap
					spacing="none"
					style={{
						flexDirection: "row",
						marginBottom: theme.spacing.sectionGap,
					}}
				>
					<View style={styles.column}>
						<Text style={styles.label} noMargin>
							From
						</Text>
						{fromLines.map((line, index) => (
							<Text key={index} variant="xs" noMargin>
								{line}
							</Text>
						))}
					</View>
					<View style={styles.column}>
						<Text style={styles.label} noMargin>
							Bill To
						</Text>
						{billToLines.map((line, index) => (
							<Text key={index} variant="xs" noMargin>
								{line}
							</Text>
						))}
					</View>
				</Section>
				<Table variant="compact">
					<TableHeader>
						<TableRow header>
							<TableCell>Description</TableCell>
							<TableCell align="right" width={120}>
								Amount
							</TableCell>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.lineItems.map((item, index) => (
							<TableRow key={index}>
								<TableCell>{item.description}</TableCell>
								<TableCell align="right" width={120}>
									{money(item.amount)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
				<Section noWrap spacing="none" style={{ flexDirection: "row" }}>
					<View style={{ flex: 1 }} />
					<View style={{ width: 240, marginTop: 12 }}>
						<KeyValue
							size="md"
							items={[
								{
									key: "Total",
									keyStyle: {
										color: theme.colors.foreground,
										fontWeight: "bold",
									},
									value: money(total),
									valueStyle: { fontWeight: "bold" },
								},
							]}
						/>
					</View>
				</Section>
				<Text
					variant="xs"
					color="mutedForeground"
					italic
					style={{ marginTop: theme.spacing.sectionGap }}
				>
					If applicable, customer should account for the respective VAT reverse
					charge.
				</Text>
				{data.billingNotes ? (
					<Section spacing="sm" variant="highlight">
						<Text style={styles.label} noMargin>
							Notes
						</Text>
						{lines(data.billingNotes).map((line, index) => (
							<Text key={index} variant="xs" noMargin>
								{line}
							</Text>
						))}
					</Section>
				) : null}
			</Page>
		</Document>
	);
};

export async function renderInvoicePdf(
	props: InvoiceDocumentProps,
): Promise<Buffer> {
	const pdf = await renderDocument(
		<PdfcnThemeProvider>
			<InvoiceContent {...props} />
		</PdfcnThemeProvider>,
	);
	return Buffer.from(pdf);
}
