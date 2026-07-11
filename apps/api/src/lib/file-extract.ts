import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";

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

// Quote a CSV field when it contains a delimiter, quote, or newline, doubling
// any embedded quotes — matching standard CSV escaping.
function csvEscape(value: string) {
	if (/[",\n\r]/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

function sheetToCsv(worksheet: ExcelJS.Worksheet) {
	const columnCount = worksheet.columnCount;
	const lines: string[] = [];
	worksheet.eachRow({ includeEmpty: true }, (row) => {
		const cells: string[] = [];
		for (let col = 1; col <= columnCount; col++) {
			cells.push(csvEscape(row.getCell(col).text ?? ""));
		}
		lines.push(cells.join(","));
	});
	return lines.join("\n");
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
		const workbook = new ExcelJS.Workbook();
		// exceljs's bundled types declare `Buffer extends ArrayBuffer`, which is
		// incompatible with Node's Buffer type; the loader accepts a Node Buffer
		// at runtime, so cast for the type checker only.
		await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
		return workbook.worksheets
			.map((worksheet) => `# ${worksheet.name}\n${sheetToCsv(worksheet)}`)
			.join("\n\n");
	}

	return buffer.toString("utf8");
}
