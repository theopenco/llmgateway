import { describe, expect, it } from "vitest";

import {
	type AgentCsvLog,
	buildAgentLogsCsv,
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

	it("guards non-numeric string values against formula injection", () => {
		expect(escapeCsvValue("=SUM(A1)")).toBe("'=SUM(A1)");
		expect(escapeCsvValue("+1+1")).toBe("'+1+1");
		expect(escapeCsvValue("-1-1")).toBe("'-1-1");
		expect(escapeCsvValue("@cmd")).toBe("'@cmd");
	});

	it("does not treat numeric values or numeric strings as formulas", () => {
		expect(escapeCsvValue(-1.5)).toBe("-1.5");
		expect(escapeCsvValue("-1.5")).toBe("-1.5");
		expect(escapeCsvValue("-1,5", COMMA_DECIMAL_FORMAT)).toBe("-1,5");
		expect(escapeCsvValue("+123")).toBe("+123");
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

	it("exports negative numbers unmodified", () => {
		expect(buildCsv(["cost"], [[formatCsvNumber(-1.5)]])).toBe("cost\n-1.5");
		expect(
			buildCsv(
				["cost"],
				[[formatCsvNumber(-1.5, COMMA_DECIMAL_FORMAT)]],
				COMMA_DECIMAL_FORMAT,
			),
		).toBe("cost\n-1,5");
	});
});

describe("buildAgentLogsCsv", () => {
	const log: AgentCsvLog = {
		id: "log_1",
		requestId: "req_1",
		createdAt: "2026-07-02T16:41:00.000Z",
		duration: 1200,
		usedModel: "openai/gpt-5.6-sol",
		usedProvider: "openai",
		unifiedFinishReason: "completed",
		finishReason: "stop",
		promptTokens: "214668",
		completionTokens: "7503",
		totalTokens: "222171",
		cachedTokens: "214379",
		cost: -0.334082,
		hasError: false,
		streamed: true,
	};

	it("builds header and row with the given format", () => {
		const csv = buildAgentLogsCsv([log], DEFAULT_CSV_FORMAT);
		const [header, row] = csv.split("\n");
		expect(header).toBe(
			"createdAt,usedProvider,usedModel,finishReason,promptTokens,completionTokens,totalTokens,cachedTokens,cost,hasError,streamed,duration,requestId,id",
		);
		expect(row).toBe(
			"2026-07-02T16:41:00.000Z,openai,openai/gpt-5.6-sol,completed,214668,7503,222171,214379,-0.334082,false,true,1200,req_1,log_1",
		);
	});

	it("uses comma decimals and semicolon delimiters for comma-decimal locales", () => {
		const csv = buildAgentLogsCsv(
			[{ ...log, cachedTokens: null }],
			COMMA_DECIMAL_FORMAT,
		);
		expect(csv.split("\n")[1]).toBe(
			"2026-07-02T16:41:00.000Z;openai;openai/gpt-5.6-sol;completed;214668;7503;222171;;-0,334082;false;true;1200;req_1;log_1",
		);
	});
});
