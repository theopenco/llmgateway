import { cache } from "react";

import { fetchServerData } from "@/lib/server-api";

export interface EscapeRunResponse {
	run: {
		id: string;
		levelId: number;
		levelName: string;
		levelSlug: string;
		model: string;
		usedModel: string | null;
		usedProvider: string | null;
		outcome: "escaped" | "terminated" | "timeout";
		steps: number;
		par: number;
		score: number;
		moves: string[];
		promptTokens: number;
		completionTokens: number;
		cost: number;
		createdAt: string;
	};
}

/**
 * Loads a shared run. Both the run page and its OpenGraph image render from
 * this, so it lives here rather than on either route — importing it from the
 * page module would pull that page's client components into the image bundle.
 * cache() dedupes the generateMetadata + page calls within a request.
 */
export const fetchEscapeRun = cache(
	async (runId: string): Promise<EscapeRunResponse | null> => {
		return await fetchServerData<EscapeRunResponse>(
			"GET",
			"/public/escape/runs/{id}",
			{
				params: { path: { id: runId } },
			},
		);
	},
);
