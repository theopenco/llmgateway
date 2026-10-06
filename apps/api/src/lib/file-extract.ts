import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { read, utils } from "xlsx";

import type { WorkSheet } from "xlsx";

// Defensive cap mirroring the upload route's base64 limit, so the extractor
// stays safe even if called from a new code path without an upstream guard.
const MAX_EXTRACT_BYTES = 10_000_000;
const MAX_EXTRACT_CHARS = 500_000;

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

export class ExtractedTextTooLongError extends Error {}

// Counts characters as rows are built, so a spreadsheet whose declared size
// is far larger than its contents stops at the caller's text cap instead of
// padding out millions of empty cells first.
function createCharBudget(name: string, maxChars: number) {
	let used = 0;
	return (chars: number) => {
		used += chars;
		if (used > maxChars) {
			throw new ExtractedTextTooLongError(
				`${name} has too much text to index (max ${maxChars} characters)`,
			);
		}
	};
}

function sheetToCsv(
	worksheet: ExcelJS.Worksheet,
	charge: (chars: number) => void,
) {
	const columnCount = worksheet.columnCount;
	const lines: string[] = [];
	worksheet.eachRow({ includeEmpty: true }, (row) => {
		const cells: string[] = [];
		for (let col = 1; col <= columnCount; col++) {
			const cell = csvEscape(row.getCell(col).text ?? "");
			charge(cell.length + 1);
			cells.push(cell);
		}
		lines.push(cells.join(","));
	});
	return lines.join("\n");
}

// A legacy sheet's declared range (DIMENSIONS) is not trusted: only the cells
// actually stored in the file are read.
function xlsSheetToCsv(sheet: WorkSheet, charge: (chars: number) => void) {
	const rows = new Map<number, Map<number, string>>();
	let maxCol = -1;
	let lastRow = -1;
	for (const address of Object.keys(sheet)) {
		if (address.startsWith("!")) {
			continue;
		}
		const { r, c } = utils.decode_cell(address);
		const text = utils.format_cell(sheet[address]);
		let row = rows.get(r);
		if (!row) {
			row = new Map();
			rows.set(r, row);
		}
		row.set(c, text);
		maxCol = Math.max(maxCol, c);
		lastRow = Math.max(lastRow, r);
	}
	const lines: string[] = [];
	for (let r = 0; r <= lastRow; r++) {
		const row = rows.get(r);
		const cells: string[] = [];
		for (let c = 0; c <= maxCol; c++) {
			const cell = csvEscape(row?.get(c) ?? "");
			charge(cell.length + 1);
			cells.push(cell);
		}
		lines.push(cells.join(","));
	}
	return lines.join("\n");
}

// Extract plain text from an uploaded knowledge base file. PDFs are parsed
// with unpdf (pdf.js), spreadsheets are converted sheet-by-sheet to CSV, and
// anything else is treated as UTF-8 text.
export async function extractFileText(
	name: string,
	mimeType: string,
	buffer: Buffer,
	maxChars = MAX_EXTRACT_CHARS,
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
		const charge = createCharBudget(name, maxChars);
		if (buffer.subarray(0, 8).equals(Buffer.from("d0cf11e0a1b11ae1", "hex"))) {
			const workbook = read(buffer, { type: "buffer" });
			return workbook.SheetNames.map(
				(sheetName) =>
					`# ${sheetName}\n${xlsSheetToCsv(workbook.Sheets[sheetName]!, charge)}`,
			).join("\n\n");
		}
		const workbook = new ExcelJS.Workbook();
		// exceljs's bundled types declare `Buffer extends ArrayBuffer`, which is
		// incompatible with Node's Buffer type; the loader accepts a Node Buffer
		// at runtime, so cast for the type checker only.
		await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
		return workbook.worksheets
			.map(
				(worksheet) => `# ${worksheet.name}\n${sheetToCsv(worksheet, charge)}`,
			)
			.join("\n\n");
	}

	return buffer.toString("utf8");
}
