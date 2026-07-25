import { createPublicServerApiClient } from "@/lib/server-api";

import type { paths } from "@/lib/api/v1";

export type ModelSurveyResults =
	paths["/public/model-survey/results"]["get"]["responses"][200]["content"]["application/json"];

export type ModelSurveyModel = ModelSurveyResults["models"][number];

// The census launched with the 2026 edition; anything earlier 404s.
export const FIRST_SURVEY_YEAR = 2026;

/**
 * Fetch the public, aggregated results of the yearly DevPass model survey.
 * Returns null on failure. Used by the public /data/[year] census pages.
 */
export async function fetchModelSurveyResults(
	year: number,
): Promise<ModelSurveyResults | null> {
	const client = createPublicServerApiClient();
	try {
		const { data } = await client.GET("/public/model-survey/results", {
			params: { query: { year } },
			next: { revalidate: 300 },
		});
		return data ?? null;
	} catch {
		return null;
	}
}
