import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { extractFileText } from "./file-extract.js";

async function buildXlsx(
	sheetName: string,
	rows: (string | number)[][],
): Promise<Buffer> {
	const workbook = new ExcelJS.Workbook();
	const sheet = workbook.addWorksheet(sheetName);
	sheet.addRows(rows);
	return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe("extractFileText", () => {
	it("passes plain text through as UTF-8", async () => {
		const text = await extractFileText(
			"notes.txt",
			"text/plain",
			Buffer.from("hello world"),
		);
		expect(text).toBe("hello world");
	});

	it("converts spreadsheet sheets to CSV with sheet headers", async () => {
		const buffer = await buildXlsx("Team", [
			["name", "role"],
			["Ada", "engineer"],
		]);

		const text = await extractFileText(
			"team.xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			buffer,
		);
		expect(text).toContain("# Team");
		expect(text).toContain("name,role");
		expect(text).toContain("Ada,engineer");
	});

	it("quotes CSV fields containing commas", async () => {
		const buffer = await buildXlsx("Places", [
			["city", "country"],
			["Lund, Skåne", "Sweden"],
		]);

		const text = await extractFileText(
			"places.xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			buffer,
		);
		expect(text).toContain('"Lund, Skåne",Sweden');
	});

	it("rejects unreadable spreadsheet data", async () => {
		await expect(
			extractFileText(
				"legacy.xls",
				"application/vnd.ms-excel",
				Buffer.from("not a real spreadsheet"),
			),
		).rejects.toThrow();
	});

	it("rejects buffers over the extraction size cap", async () => {
		await expect(
			extractFileText("huge.txt", "text/plain", Buffer.alloc(10_000_001, 97)),
		).rejects.toThrow(/too large/);
	});

	it("rejects invalid PDF data", async () => {
		await expect(
			extractFileText(
				"broken.pdf",
				"application/pdf",
				Buffer.from("not a real pdf"),
			),
		).rejects.toThrow();
	});
});
