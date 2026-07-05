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
