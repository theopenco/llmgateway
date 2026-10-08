import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { utils, write } from "xlsx";

import { ExtractedTextTooLongError, extractFileText } from "./file-extract.js";

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

	it("extracts a legacy binary XLS workbook with multiple sheets", async () => {
		const workbook = utils.book_new();
		utils.book_append_sheet(
			workbook,
			utils.aoa_to_sheet([
				["name", "value"],
				["Lund, Skåne", 42],
			]),
			"Places",
		);
		utils.book_append_sheet(
			workbook,
			utils.aoa_to_sheet([["second sheet"]]),
			"Notes",
		);
		const buffer: Buffer = write(workbook, {
			type: "buffer",
			bookType: "biff8",
		});
		const text = await extractFileText(
			"places.xls",
			"application/vnd.ms-excel",
			buffer,
		);
		expect(text).toContain('# Places\nname,value\n"Lund, Skåne",42');
		expect(text).toContain("# Notes\nsecond sheet");
	});

	it("ignores a forged XLS sheet range", async () => {
		const workbook = utils.book_new();
		utils.book_append_sheet(
			workbook,
			utils.aoa_to_sheet([["name"], ["Ada"]]),
			"Forged",
		);
		const buffer: Buffer = write(workbook, {
			type: "buffer",
			bookType: "biff8",
		});
		// Patch the DIMENSIONS record (0x0200, 14 bytes) to claim 4.29 billion
		// rows by 256 columns, as a hand-forged file would.
		const dimensions = buffer.indexOf(Buffer.from([0x00, 0x02, 0x0e, 0x00]));
		buffer.writeUInt32LE(0xffffffff, dimensions + 8);
		buffer.writeUInt16LE(256, dimensions + 14);

		const start = performance.now();
		const text = await extractFileText(
			"forged.xls",
			"application/vnd.ms-excel",
			buffer,
		);
		expect(performance.now() - start).toBeLessThan(2000);
		expect(text).toBe("# Forged\nname\nAda");
	});

	it("stops a sparse XLS sheet at the text cap instead of padding it", async () => {
		const sheet = utils.aoa_to_sheet([["first"]]);
		sheet.A60000 = { t: "s", v: "far away" };
		sheet["!ref"] = "A1:A60000";
		const workbook = utils.book_new();
		utils.book_append_sheet(workbook, sheet, "Sparse");
		const buffer: Buffer = write(workbook, {
			type: "buffer",
			bookType: "biff8",
		});

		await expect(
			extractFileText("sparse.xls", "application/vnd.ms-excel", buffer, 1000),
		).rejects.toThrow(ExtractedTextTooLongError);
	});

	it("stops a sparse XLSX sheet at the cap without building every row", async () => {
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Sparse");
		sheet.getCell("A1").value = "first";
		sheet.getCell("A1048576").value = "last";
		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
		// Each Row object ExcelJS materialises goes through getRow.
		const getRow = vi.spyOn(Object.getPrototypeOf(sheet), "getRow");

		await expect(
			extractFileText(
				"sparse.xlsx",
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				buffer,
			),
		).rejects.toThrow(ExtractedTextTooLongError);
		expect(getRow.mock.calls.length).toBeLessThan(10);
		getRow.mockRestore();
	});

	it("keeps empty rows and cells between present XLSX values", async () => {
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet("Gaps");
		sheet.getCell("A1").value = "a";
		sheet.getCell("C1").value = "c";
		sheet.getCell("B3").value = "b";
		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

		expect(
			await extractFileText(
				"gaps.xlsx",
				"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
				buffer,
			),
		).toBe("# Gaps\na,,c\n,,\n,b,");
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
