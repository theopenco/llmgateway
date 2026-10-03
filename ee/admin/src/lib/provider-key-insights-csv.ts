import {
	buildCsv,
	DEFAULT_CSV_FORMAT,
	deriveStabilityMetrics,
	formatCsvNumber,
} from "@llmgateway/shared";

import type { CsvFormat } from "@llmgateway/shared";

interface ErrorSplit {
	requestCount: number;
	errorCount: number;
	clientErrorCount: number;
	gatewayErrorCount: number;
	upstreamErrorCount: number;
}

export interface ProviderKeyCsvPoint extends ErrorSplit {
	timestamp: string;
	cacheCount: number;
	inputTokens: string;
	outputTokens: string;
	totalTokens: string;
	cost: number;
}

export interface ProviderKeyCsvModel extends ErrorSplit {
	usedModel: string;
	usedProvider: string;
	cacheCount: number;
	lengthLimitCount: number;
	contentFilterCount: number;
	canceledCount: number;
	totalTokens: string;
	cost: number;
}

export interface ProviderKeyCsvOrganization extends ErrorSplit {
	organizationId: string;
	organizationName: string | null;
	cost: number;
}

export interface ProviderKeyCsvErrorType {
	statusCode: number | null;
	statusText: string | null;
	classification: string | null;
	count: number;
	streamedCount: number;
	cause: string | null;
	responseText: string | null;
	models: { usedModel: string; count: number }[];
}

export interface ProviderKeyCsvReport {
	generatedAt: Date;
	key: {
		id: string;
		provider: string;
		maskedToken: string;
		comment: string | null;
		managed: boolean;
		variant: string;
		region: string | null;
		status: string | null;
		usage: string;
		usageLimit: string | null;
	};
	window: string;
	bucket: string;
	/** Zero-filled, one row per bucket of the window. */
	points: ProviderKeyCsvPoint[];
	modelsSince: string;
	models: ProviderKeyCsvModel[];
	organizations: ProviderKeyCsvOrganization[];
	errorTypes: {
		window: string;
		includeRetried: boolean;
		sampledErrors: number;
		errors: ProviderKeyCsvErrorType[];
	} | null;
}

/** Same definition as the page: gateway + upstream over non-client requests. */
function errorRatePercent(row: ErrorSplit, format: CsvFormat) {
	return formatCsvNumber(
		deriveStabilityMetrics({
			logsCount: row.requestCount,
			clientErrorsCount: row.clientErrorCount,
			gatewayErrorsCount: row.gatewayErrorCount,
			upstreamErrorsCount: row.upstreamErrorCount,
		}).errorRate,
		format,
	);
}

const ERROR_SPLIT_COLUMNS = [
	"requestCount",
	"errorRatePercent",
	"errorCount",
	"upstreamErrorCount",
	"gatewayErrorCount",
	"clientErrorCount",
];

function errorSplitCells(row: ErrorSplit, format: CsvFormat) {
	return [
		formatCsvNumber(row.requestCount, format),
		errorRatePercent(row, format),
		formatCsvNumber(row.errorCount, format),
		formatCsvNumber(row.upstreamErrorCount, format),
		formatCsvNumber(row.gatewayErrorCount, format),
		formatCsvNumber(row.clientErrorCount, format),
	];
}

/** Decimal strings are exact; a float round-trip would add noise digits. */
function formatCsvDecimal(value: string, format: CsvFormat) {
	return format.decimalSeparator === "."
		? value
		: value.replace(".", format.decimalSeparator);
}

function sum<T>(rows: readonly T[], pick: (row: T) => number) {
	return rows.reduce((total, row) => total + pick(row), 0);
}

/**
 * Everything the insights page shows for one credential, as blank-line
 * separated CSV sections in one file, like the Global Stats report.
 */
export function buildProviderKeyReportCsv(
	report: ProviderKeyCsvReport,
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	const { key, points } = report;
	const totals: ErrorSplit = {
		requestCount: sum(points, (p) => p.requestCount),
		errorCount: sum(points, (p) => p.errorCount),
		clientErrorCount: sum(points, (p) => p.clientErrorCount),
		gatewayErrorCount: sum(points, (p) => p.gatewayErrorCount),
		upstreamErrorCount: sum(points, (p) => p.upstreamErrorCount),
	};

	const sections: { title: string; csv: string }[] = [
		{
			title: "Provider key insights report",
			csv: buildCsv(
				["field", "value"],
				[
					["generated", report.generatedAt.toISOString()],
					["providerKeyId", key.id],
					["provider", key.provider],
					["key", key.maskedToken],
					["note", key.comment ?? ""],
					["managed", key.managed],
					["variant", key.variant],
					["region", key.region ?? ""],
					["status", key.status ?? ""],
					["window", report.window],
					["bucket", report.bucket],
				],
				format,
			),
		},
		{
			title: "Totals",
			csv: buildCsv(
				["metric", "value"],
				[
					...ERROR_SPLIT_COLUMNS.map((column, i) => [
						column,
						errorSplitCells(totals, format)[i],
					]),
					[
						"cacheCount",
						formatCsvNumber(
							sum(points, (p) => p.cacheCount),
							format,
						),
					],
					[
						"totalTokens",
						formatCsvNumber(
							sum(points, (p) => Number(p.totalTokens)),
							format,
						),
					],
					[
						"cost",
						formatCsvNumber(
							sum(points, (p) => p.cost),
							format,
						),
					],
					["lifetimeUsage", formatCsvDecimal(key.usage, format)],
					[
						"usageLimit",
						key.usageLimit === null
							? ""
							: formatCsvDecimal(key.usageLimit, format),
					],
				],
				format,
			),
		},
		{
			title: `Timeseries (per ${report.bucket}, UTC)`,
			csv: buildCsv(
				[
					"timestamp",
					...ERROR_SPLIT_COLUMNS,
					"cacheCount",
					"inputTokens",
					"outputTokens",
					"totalTokens",
					"cost",
				],
				points.map((point) => [
					point.timestamp,
					...errorSplitCells(point, format),
					formatCsvNumber(point.cacheCount, format),
					formatCsvNumber(Number(point.inputTokens), format),
					formatCsvNumber(Number(point.outputTokens), format),
					formatCsvNumber(Number(point.totalTokens), format),
					formatCsvNumber(point.cost, format),
				]),
				format,
			),
		},
		{
			title: `By model (UTC days since ${report.modelsSince.slice(0, 10)})`,
			csv: buildCsv(
				[
					"usedModel",
					"usedProvider",
					...ERROR_SPLIT_COLUMNS,
					"lengthLimitCount",
					"contentFilterCount",
					"canceledCount",
					"cacheCount",
					"totalTokens",
					"cost",
				],
				report.models.map((model) => [
					model.usedModel,
					model.usedProvider,
					...errorSplitCells(model, format),
					formatCsvNumber(model.lengthLimitCount, format),
					formatCsvNumber(model.contentFilterCount, format),
					formatCsvNumber(model.canceledCount, format),
					formatCsvNumber(model.cacheCount, format),
					formatCsvNumber(Number(model.totalTokens), format),
					formatCsvNumber(model.cost, format),
				]),
				format,
			),
		},
		{
			title: "By organization",
			csv: buildCsv(
				["organizationId", "organizationName", ...ERROR_SPLIT_COLUMNS, "cost"],
				report.organizations.map((org) => [
					org.organizationId,
					org.organizationName ?? "",
					...errorSplitCells(org, format),
					formatCsvNumber(org.cost, format),
				]),
				format,
			),
		},
	];

	if (report.errorTypes) {
		const { errorTypes } = report;
		sections.push({
			title: `Error details (last ${errorTypes.window}, ${
				errorTypes.includeRetried ? "including" : "excluding"
			} retried, ${errorTypes.sampledErrors} sampled)`,
			csv: buildCsv(
				[
					"statusCode",
					"statusText",
					"classification",
					"count",
					"streamedCount",
					"models",
					"cause",
					"responseText",
				],
				errorTypes.errors.map((error) => [
					error.statusCode ?? "",
					error.statusText ?? "",
					error.classification ?? "",
					formatCsvNumber(error.count, format),
					formatCsvNumber(error.streamedCount, format),
					error.models
						.map((model) => `${model.usedModel}: ${model.count}`)
						.join(" | "),
					error.cause ?? "",
					error.responseText ?? "",
				]),
				format,
			),
		});
	}

	return sections
		.map(
			(section) => `${buildCsv([section.title], [], format)}\n${section.csv}`,
		)
		.join("\n\n");
}

export function providerKeyReportFilename(
	providerKeyId: string,
	window: string,
	generatedAt: Date,
): string {
	return `provider-key-${providerKeyId}-${window}-${generatedAt.toISOString().slice(0, 10)}.csv`;
}
