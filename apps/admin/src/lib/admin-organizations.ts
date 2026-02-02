import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface Organization {
	id: string;
	name: string;
	billingEmail: string;
	plan: string;
	devPlan: string;
	credits: string;
	createdAt: string;
	status: string | null;
}

export interface OrganizationsListResponse {
	organizations: Organization[];
	total: number;
	limit: number;
	offset: number;
}

export type TokenWindow = "7d" | "30d";

export interface OrganizationMetrics {
	organization: Organization;
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

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	const hasAuth = !!(sessionCookie || secureSessionCookie);
	if (!hasAuth) {
		console.log("[admin-organizations] No session cookie found");
	}
	return hasAuth;
}

export async function getOrganizations(params?: {
	limit?: number;
	offset?: number;
	search?: string;
}): Promise<OrganizationsListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<OrganizationsListResponse>(
		"GET",
		"/admin/organizations",
		{
			params: {
				query: {
					limit: params?.limit ?? 50,
					offset: params?.offset ?? 0,
					search: params?.search,
				},
			},
		},
	);

	return data;
}

export async function getOrganizationMetrics(
	orgId: string,
	window: TokenWindow = "7d",
): Promise<OrganizationMetrics | null> {
	if (!(await hasSession())) {
		console.log("[getOrganizationMetrics] No session found");
		return null;
	}

	console.log("[getOrganizationMetrics] Fetching metrics for org:", orgId);
	const data = await fetchServerData<OrganizationMetrics>(
		"GET",
		"/admin/organizations/{orgId}",
		{
			params: {
				path: {
					orgId,
				},
				query: {
					window,
				},
			},
		},
	);
	console.log("[getOrganizationMetrics] Result:", data ? "success" : "null");

	return data;
}
