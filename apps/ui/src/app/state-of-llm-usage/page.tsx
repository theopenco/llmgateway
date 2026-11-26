import { notFound, redirect } from "next/navigation";

import { fetchServerData } from "@/lib/server-api";
import {
	USAGE_REPORT_PATH,
	usageReportYears,
	type UsageReport,
} from "@/lib/usage-report";

import type { Route } from "next";

export const dynamic = "force-dynamic";

// The newest year with traffic: in the first days of January that is still
// the previous year.
export default async function StateOfLlmUsageIndex() {
	for (const year of usageReportYears()) {
		const report = await fetchServerData<UsageReport>(
			"GET",
			"/public/models/report",
			{ params: { query: { year } } },
		);
		if (report && report.totals.totalTokens > 0) {
			redirect(`${USAGE_REPORT_PATH}/${year}` as Route);
		}
	}
	notFound();
}
