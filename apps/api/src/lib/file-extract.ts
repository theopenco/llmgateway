import { extractText, getDocumentProxy } from "unpdf";
import * as XLSX from "xlsx";

// Defensive cap mirroring the upload route's base64 limit, so the extractor
// stays safe even if called from a new code path without an upstream guard.
const MAX_EXTRACT_BYTES = 10_000_000;

function isPdf(name: string, mimeType: string) {
	return mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf");
}

function isSpreadsheet(name: string, mimeType: string) {
	const lower = name.toLowerCase();
	return (
		lower.endsWith(".xlsx") ||
		lower.endsWith(".xls") ||
		mimeType === "application/vnd.ms-excel" ||
		mimeType ===
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	);
}

// Extract plain text from an uploaded knowledge base file. PDFs are parsed
// with unpdf (pdf.js), spreadsheets are converted sheet-by-sheet to CSV, and
// anything else is treated as UTF-8 text.
export async function extractFileText(
	name: string,
	mimeType: string,
	buffer: Buffer,
): Promise<string> {
	if (buffer.length > MAX_EXTRACT_BYTES) {
		throw new Error(`${name} is too large to extract`);
	}

	if (isPdf(name, mimeType)) {
		const pdf = await getDocumentProxy(new Uint8Array(buffer));
		const { text } = await extractText(pdf, { mergePages: true });
		return text;
	}

	if (isSpreadsheet(name, mimeType)) {
		const workbook = XLSX.read(buffer, { type: "buffer" });
		return workbook.SheetNames.map((sheetName) => {
			const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
			return `# ${sheetName}\n${csv}`;
		}).join("\n\n");
	}

	return buffer.toString("utf8");
}
