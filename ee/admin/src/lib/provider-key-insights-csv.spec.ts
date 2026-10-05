import { describe, expect, test } from "vitest";

import {
	buildProviderKeyReportCsv,
	providerKeyReportFilename,
} from "./provider-key-insights-csv";

import type { ProviderKeyCsvReport } from "./provider-key-insights-csv";

const split = {
	requestCount: 100,
	errorCount: 15,
	clientErrorCount: 10,
	gatewayErrorCount: 3,
	upstreamErrorCount: 2,
};

const report: ProviderKeyCsvReport = {
	generatedAt: new Date("2026-10-03T12:00:00.000Z"),
	key: {
		id: "key-1",
		provider: "openai",
		maskedToken: "sk-abc•••••1234",
		comment: "Primary, EU",
		managed: true,
		variant: "default",
		region: null,
		status: "active",
		usage: "12.5",
		usageLimit: null,
	},
	window: "7d",
	bucket: "hour",
	points: [
		{
			timestamp: "2026-10-03T10:00:00.000Z",
			...split,
			cacheCount: 4,
			inputTokens: "900",
			outputTokens: "300",
			totalTokens: "1200",
			cost: 0.0000005,
		},
		{
			timestamp: "2026-10-03T11:00:00.000Z",
			requestCount: 0,
			errorCount: 0,
			clientErrorCount: 0,
			gatewayErrorCount: 0,
			upstreamErrorCount: 0,
			cacheCount: 0,
			inputTokens: "0",
			outputTokens: "0",
			totalTokens: "0",
			cost: 0,
		},
	],
	modelsSince: "2026-09-27T00:00:00.000Z",
	models: [
		{
			usedModel: "openai/gpt-4o",
			usedProvider: "openai",
			...split,
			cacheCount: 4,
			lengthLimitCount: 1,
			contentFilterCount: 0,
			canceledCount: 2,
			totalTokens: "1200",
			cost: 0.25,
		},
	],
	organizations: [
		{
			organizationId: "org-1",
			organizationName: "Test Organization",
			...split,
			cost: 0.25,
		},
	],
	errorTypes: {
		window: "24h",
		includeRetried: true,
		sampledErrors: 5,
		errors: [
			{
				statusCode: 429,
				statusText: "Too Many Requests",
				classification: "upstream_error",
				count: 5,
				streamedCount: 2,
				cause: null,
				responseText: '{"error":"rate limited"}',
				models: [
					{ usedModel: "openai/gpt-4o", count: 3 },
					{ usedModel: "openai/gpt-4o-mini", count: 2 },
				],
			},
		],
	},
};

function section(csv: string, title: string) {
	// Titles containing the delimiter are quoted.
	const block = csv
		.split("\n\n")
		.find((part) => part.replace(/^"/, "").startsWith(title));
	return block?.split("\n").slice(1) ?? [];
}

describe("buildProviderKeyReportCsv", () => {
	test("writes every section with the page's error-rate definition", () => {
		const csv = buildProviderKeyReportCsv(report);

		expect(section(csv, "Provider key insights report")).toContain(
			'note,"Primary, EU"',
		);
		// 5 stability errors over 90 non-client-error requests.
		expect(section(csv, "Totals")).toContain(
			"errorRatePercent,5.555555555555555",
		);
		expect(section(csv, "Totals")).toContain("lifetimeUsage,12.5");
		expect(section(csv, "Timeseries")).toEqual([
			"timestamp,requestCount,errorRatePercent,errorCount,upstreamErrorCount,gatewayErrorCount,clientErrorCount,cacheCount,inputTokens,outputTokens,totalTokens,cost",
			"2026-10-03T10:00:00.000Z,100,5.555555555555555,15,2,3,10,4,900,300,1200,0.0000005",
			// No requests: the rate is unknown, not 0%.
			"2026-10-03T11:00:00.000Z,0,,0,0,0,0,0,0,0,0,0",
		]);
		expect(section(csv, "By model (UTC days since 2026-09-27)")[1]).toBe(
			"openai/gpt-4o,openai,100,5.555555555555555,15,2,3,10,1,0,2,4,1200,0.25",
		);
		expect(section(csv, "By organization")[1]).toBe(
			"org-1,Test Organization,100,5.555555555555555,15,2,3,10,0.25",
		);
		expect(section(csv, "Error details (last 24h")[1]).toBe(
			'429,Too Many Requests,upstream_error,5,2,openai/gpt-4o: 3 | openai/gpt-4o-mini: 2,,"{""error"":""rate limited""}"',
		);
	});

	test("omits error details when they have not loaded", () => {
		const csv = buildProviderKeyReportCsv({ ...report, errorTypes: null });
		expect(csv).not.toContain("Error details");
	});

	test("honours comma-decimal locales", () => {
		const csv = buildProviderKeyReportCsv(report, {
			delimiter: ";",
			decimalSeparator: ",",
		});
		expect(section(csv, "By organization")[1]).toBe(
			"org-1;Test Organization;100;5,555555555555555;15;2;3;10;0,25",
		);
	});
});

test("providerKeyReportFilename", () => {
	expect(
		providerKeyReportFilename(
			"key-1",
			"90d",
			new Date("2026-10-03T12:00:00.000Z"),
		),
	).toBe("provider-key-key-1-90d-2026-10-03.csv");
});
