import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface ProviderStats {
	id: string;
	name: string;
	color: string | null;
	status: string;
	logsCount: number;
	errorsCount: number;
	cachedCount: number;
	avgTimeToFirstToken: number | null;
	modelCount: number;
	updatedAt: string;
}

export interface ProvidersListResponse {
	providers: ProviderStats[];
	total: number;
}

export type ProviderSortBy =
	| "name"
	| "logsCount"
	| "errorsCount"
	| "cachedCount"
	| "avgTimeToFirstToken"
	| "modelCount";
export type SortOrder = "asc" | "desc";

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	return !!(sessionCookie ?? secureSessionCookie);
}

export async function getProviders(params?: {
	sortBy?: ProviderSortBy;
	sortOrder?: SortOrder;
}): Promise<ProvidersListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<ProvidersListResponse>(
		"GET",
		"/admin/providers",
		{
			params: {
				query: {
					sortBy: params?.sortBy,
					sortOrder: params?.sortOrder,
				},
			},
		},
	);

	return data;
}
