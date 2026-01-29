import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export type TokenWindow = "7d" | "30d";

export interface AdminTokenMetrics {
	window: TokenWindow;
	startDate: string;
	endDate: string;
	totalRequests: number;
	totalTokens: number;
	totalCost: number;
	inputTokens: number;
	inputCost: number;
	outputTokens: number;
	outputCost: number;
	cachedTokens: number;
	cachedCost: number;
	mostUsedModel: string | null;
	mostUsedProvider: string | null;
	mostUsedModelRequestCount: number;
}

export async function getAdminTokenMetrics(
	window: TokenWindow,
): Promise<AdminTokenMetrics | null> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);

	if (!sessionCookie && !secureSessionCookie) {
		return null;
	}

	const data = await fetchServerData<AdminTokenMetrics>(
		"GET",
		"/admin/tokens",
		{
			params: {
				query: {
					window,
				},
			},
		},
	);

	return data;
}
