import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface ModelStats {
	id: string;
	name: string;
	family: string;
	free: boolean;
	stability: string;
	status: string;
	logsCount: number;
	errorsCount: number;
	cachedCount: number;
	avgTimeToFirstToken: number | null;
	providerCount: number;
	updatedAt: string;
}

export interface ModelsListResponse {
	models: ModelStats[];
	total: number;
	limit: number;
	offset: number;
}

export type ModelSortBy =
	| "name"
	| "family"
	| "logsCount"
	| "errorsCount"
	| "cachedCount"
	| "avgTimeToFirstToken"
	| "providerCount";
export type SortOrder = "asc" | "desc";

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	return !!(sessionCookie || secureSessionCookie);
}

export async function getModels(params?: {
	search?: string;
	family?: string;
	sortBy?: ModelSortBy;
	sortOrder?: SortOrder;
	limit?: number;
	offset?: number;
}): Promise<ModelsListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<ModelsListResponse>(
		"GET",
		"/admin/models",
		{
			params: {
				query: {
					search: params?.search,
					family: params?.family,
					sortBy: params?.sortBy,
					sortOrder: params?.sortOrder,
					limit: params?.limit ?? 50,
					offset: params?.offset ?? 0,
				},
			},
		},
	);

	return data;
}
