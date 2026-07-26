export interface CsvFormat {
	delimiter: "," | ";";
	decimalSeparator: "." | ",";
}

export const DEFAULT_CSV_FORMAT: CsvFormat = {
	delimiter: ",",
	decimalSeparator: ".",
};

// Spreadsheets parse CSV numbers with the viewer's locale: in comma-decimal
// locales a dot reads as a thousands separator, so "0.334082" silently becomes
// 334082. Detect the locale's decimal separator and, for comma-decimal
// locales, emit comma decimals with ";" as the field delimiter — the CSV
// convention spreadsheets expect there.
export function detectCsvFormat(locale?: string): CsvFormat {
	let decimal: string | undefined;
	try {
		decimal = new Intl.NumberFormat(locale)
			.formatToParts(1.1)
			.find((part) => part.type === "decimal")?.value;
	} catch {
		decimal = undefined;
	}
	return decimal === ","
		? { delimiter: ";", decimalSeparator: "," }
		: DEFAULT_CSV_FORMAT;
}

export function escapeCsvValue(
	value: unknown,
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	if (value === null || value === undefined) {
		return "";
	}
	let str = String(value);
	// Guard against spreadsheet formula injection for string values.
	if (typeof value === "string" && /^[=+\-@\t\r]/.test(str)) {
		str = `'${str}`;
	}
	if (str.includes(format.delimiter) || /["\n\r]/.test(str)) {
		return `"${str.replace(/"/g, '""')}"`;
	}
	return str;
}

// String(number) switches to exponent notation below 1e-6 (e.g. "3.5e-7"),
// which spreadsheets don't reliably parse as a float, and keeps float-noise
// digits (e.g. "0.00012000000000000002").
export function formatCsvNumber(
	value: number | null | undefined,
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	if (value === null || value === undefined) {
		return "";
	}
	const plain = value.toFixed(15).replace(/\.?0+$/, "");
	return format.decimalSeparator === "."
		? plain
		: plain.replace(".", format.decimalSeparator);
}

export function buildCsv(
	headers: readonly string[],
	rows: readonly (readonly unknown[])[],
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	return [headers, ...rows]
		.map((row) =>
			row.map((value) => escapeCsvValue(value, format)).join(format.delimiter),
		)
		.join("\n");
}
