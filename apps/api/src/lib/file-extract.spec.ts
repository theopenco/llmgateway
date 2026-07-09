import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { extractFileText } from "./file-extract.js";

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
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			["name", "role"],
			["Ada", "engineer"],
		]);
		XLSX.utils.book_append_sheet(workbook, sheet, "Team");
		const buffer = XLSX.write(workbook, {
			type: "buffer",
			bookType: "xlsx",
		}) as Buffer;

		const text = await extractFileText(
			"team.xlsx",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			buffer,
		);
		expect(text).toContain("# Team");
		expect(text).toContain("name,role");
		expect(text).toContain("Ada,engineer");
	});

	it("converts legacy .xls workbooks to CSV", async () => {
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			["city", "country"],
			["Lund", "Sweden"],
		]);
		XLSX.utils.book_append_sheet(workbook, sheet, "Places");
		const buffer = XLSX.write(workbook, {
			type: "buffer",
			bookType: "xls",
		}) as Buffer;

		const text = await extractFileText(
			"places.xls",
			"application/vnd.ms-excel",
			buffer,
		);
		expect(text).toContain("# Places");
		expect(text).toContain("Lund,Sweden");
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
