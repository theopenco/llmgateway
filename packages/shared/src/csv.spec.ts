import { describe, expect, it } from "vitest";

import {
	buildCsv,
	DEFAULT_CSV_FORMAT,
	detectCsvFormat,
	escapeCsvValue,
	formatCsvNumber,
	type CsvFormat,
} from "./csv.js";

const COMMA_DECIMAL_FORMAT: CsvFormat = {
	delimiter: ";",
	decimalSeparator: ",",
};

describe("detectCsvFormat", () => {
	it("returns dot decimals and comma delimiter for dot-decimal locales", () => {
		expect(detectCsvFormat("en-US")).toEqual(DEFAULT_CSV_FORMAT);
	});

	it("returns comma decimals and semicolon delimiter for comma-decimal locales", () => {
		expect(detectCsvFormat("fr-FR")).toEqual(COMMA_DECIMAL_FORMAT);
		expect(detectCsvFormat("de-DE")).toEqual(COMMA_DECIMAL_FORMAT);
	});

	it("falls back to the default format for invalid locales", () => {
		expect(detectCsvFormat("not a locale")).toEqual(DEFAULT_CSV_FORMAT);
	});
});

describe("formatCsvNumber", () => {
	it("formats sub-1e-6 values as plain decimals", () => {
		expect(formatCsvNumber(3.5e-7)).toBe("0.00000035");
	});

	it("trims float noise", () => {
		expect(formatCsvNumber(0.00012000000000000002)).toBe("0.00012");
		expect(formatCsvNumber(0.30000000000000004)).toBe("0.3");
	});

	it("keeps integers intact", () => {
		expect(formatCsvNumber(10)).toBe("10");
		expect(formatCsvNumber(0)).toBe("0");
	});

	it("returns an empty string for nullish values", () => {
		expect(formatCsvNumber(null)).toBe("");
		expect(formatCsvNumber(undefined)).toBe("");
	});

	it("uses the locale decimal separator", () => {
		expect(formatCsvNumber(0.334082, COMMA_DECIMAL_FORMAT)).toBe("0,334082");
		expect(formatCsvNumber(3.5e-7, COMMA_DECIMAL_FORMAT)).toBe("0,00000035");
	});
});

describe("escapeCsvValue", () => {
	it("returns an empty string for nullish values", () => {
		expect(escapeCsvValue(null)).toBe("");
		expect(escapeCsvValue(undefined)).toBe("");
	});

	it("quotes values containing the active delimiter", () => {
		expect(escapeCsvValue("a,b")).toBe('"a,b"');
		expect(escapeCsvValue("a,b", COMMA_DECIMAL_FORMAT)).toBe("a,b");
		expect(escapeCsvValue("a;b", COMMA_DECIMAL_FORMAT)).toBe('"a;b"');
	});

	it("quotes values containing quotes or newlines", () => {
		expect(escapeCsvValue('say "hi"')).toBe('"say ""hi"""');
		expect(escapeCsvValue("line1\nline2")).toBe('"line1\nline2"');
	});

	it("guards string values against formula injection", () => {
		expect(escapeCsvValue("=SUM(A1)")).toBe("'=SUM(A1)");
		expect(escapeCsvValue("+123")).toBe("'+123");
	});

	it("does not treat negative numbers as formulas", () => {
		expect(escapeCsvValue(-1.5)).toBe("-1.5");
	});
});

describe("buildCsv", () => {
	it("joins headers and rows with the active delimiter", () => {
		const csv = buildCsv(
			["a", "b"],
			[
				[1, "x"],
				[2, "y,z"],
			],
		);
		expect(csv).toBe('a,b\n1,x\n2,"y,z"');
	});

	it("builds semicolon-delimited output for comma-decimal locales", () => {
		const csv = buildCsv(
			["cost", "model"],
			[[formatCsvNumber(0.334082, COMMA_DECIMAL_FORMAT), "gpt-5.6-sol"]],
			COMMA_DECIMAL_FORMAT,
		);
		expect(csv).toBe("cost;model\n0,334082;gpt-5.6-sol");
	});
});
