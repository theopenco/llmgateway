import { getConfig } from "@/lib/config-server";

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
	const config = getConfig();
	try {
		const res = await fetch(
			`${config.apiBackendUrl}/public/model-survey/results?year=${year}`,
			{ next: { revalidate: 300 } },
		);
		if (!res.ok) {
			return null;
		}
		return (await res.json()) as ModelSurveyResults;
	} catch {
		return null;
	}
}
