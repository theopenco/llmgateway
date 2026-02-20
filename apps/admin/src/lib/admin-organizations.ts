"use server";

import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface Organization {
	id: string;
	name: string;
	billingEmail: string;
	plan: string;
	devPlan: string;
	credits: string;
	totalCreditsAllTime?: string;
	totalSpent?: string;
	createdAt: string;
	status: string | null;
}

export interface OrganizationsListResponse {
	organizations: Organization[];
	total: number;
	totalCredits: string;
	limit: number;
	offset: number;
}

export type TokenWindow =
	| "1h"
	| "4h"
	| "12h"
	| "1d"
	| "7d"
	| "30d"
	| "90d"
	| "365d";

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
	mostUsedModelCost: number;
	discountSavings: number;
}

export interface Transaction {
	id: string;
	createdAt: string;
	type: string;
	amount: string | null;
	creditAmount: string | null;
	currency: string;
	status: string;
	description: string | null;
}

export interface TransactionsListResponse {
	organization: Organization;
	transactions: Transaction[];
	total: number;
	limit: number;
	offset: number;
}

export interface Project {
	id: string;
	name: string;
	mode: string;
	status: string | null;
	cachingEnabled: boolean;
	createdAt: string;
}

export interface ProjectsListResponse {
	projects: Project[];
	total: number;
}

export interface ApiKey {
	id: string;
	token: string;
	description: string;
	status: string | null;
	usage: string;
	usageLimit: string | null;
	projectId: string;
	projectName: string;
	createdAt: string;
}

export interface ApiKeysListResponse {
	apiKeys: ApiKey[];
	total: number;
	limit: number;
	offset: number;
}

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	const hasAuth = !!(sessionCookie ?? secureSessionCookie);
	if (!hasAuth) {
		console.log("[admin-organizations] No session cookie found");
	}
	return hasAuth;
}

export type SortBy =
	| "name"
	| "billingEmail"
	| "plan"
	| "devPlan"
	| "credits"
	| "createdAt"
	| "status"
	| "totalCreditsAllTime"
	| "totalSpent";
export type SortOrder = "asc" | "desc";

export async function getOrganizations(params?: {
	limit?: number;
	offset?: number;
	search?: string;
	sortBy?: SortBy;
	sortOrder?: SortOrder;
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
					sortBy: params?.sortBy,
					sortOrder: params?.sortOrder,
				},
			},
		},
	);

	return data;
}

export async function getOrganizationMetrics(
	orgId: string,
	window: TokenWindow = "1d",
): Promise<OrganizationMetrics | null> {
	if (!(await hasSession())) {
		return null;
	}

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

	return data;
}

export async function getOrganizationTransactions(
	orgId: string,
	params?: {
		limit?: number;
		offset?: number;
	},
): Promise<TransactionsListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<TransactionsListResponse>(
		"GET",
		"/admin/organizations/{orgId}/transactions" as "/admin/organizations/{orgId}",
		{
			params: {
				path: {
					orgId,
				},
				query: {
					limit: params?.limit ?? 25,
					offset: params?.offset ?? 0,
				},
			},
		},
	);

	return data;
}

export async function getOrganizationProjects(
	orgId: string,
): Promise<ProjectsListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<ProjectsListResponse>(
		"GET",
		"/admin/organizations/{orgId}/projects" as "/admin/organizations/{orgId}",
		{
			params: {
				path: {
					orgId,
				},
			},
		},
	);

	return data;
}

export async function getOrganizationApiKeys(
	orgId: string,
	params?: {
		limit?: number;
		offset?: number;
	},
): Promise<ApiKeysListResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<ApiKeysListResponse>(
		"GET",
		"/admin/organizations/{orgId}/api-keys" as "/admin/organizations/{orgId}",
		{
			params: {
				path: {
					orgId,
				},
				query: {
					limit: params?.limit ?? 25,
					offset: params?.offset ?? 0,
				},
			},
		},
	);

	return data;
}

export async function loadMetricsAction(
	orgId: string,
	window: TokenWindow,
): Promise<OrganizationMetrics | null> {
	return await getOrganizationMetrics(orgId, window);
}

export interface ProjectMetrics {
	project: Project;
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
	mostUsedModelCost: number;
	discountSavings: number;
}

export interface ProjectLogEntry {
	id: string;
	createdAt: string;
	duration: number;
	usedModel: string;
	usedProvider: string;
	totalTokens: string | null;
	cost: number | null;
	hasError: boolean | null;
	unifiedFinishReason: string | null;
	cached: boolean | null;
	cachedTokens: string | null;
	source: string | null;
	content: string | null;
	usedMode: string;
	discount: number | null;
}

export interface ProjectLogsResponse {
	logs: ProjectLogEntry[];
	pagination: {
		nextCursor: string | null;
		hasMore: boolean;
		limit: number;
	};
}

export async function getProjectMetrics(
	orgId: string,
	projectId: string,
	window: TokenWindow = "1d",
): Promise<ProjectMetrics | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<ProjectMetrics>(
		"GET",
		`/admin/organizations/${orgId}/projects/${projectId}/metrics` as "/admin/organizations/{orgId}",
		{
			params: {
				path: { orgId, projectId },
				query: { window },
			},
		},
	);

	return data;
}

export async function getProjectLogs(
	orgId: string,
	projectId: string,
	params?: {
		limit?: number;
		cursor?: string;
	},
): Promise<ProjectLogsResponse | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<ProjectLogsResponse>(
		"GET",
		`/admin/organizations/${orgId}/projects/${projectId}/logs` as "/admin/organizations/{orgId}",
		{
			params: {
				path: { orgId, projectId },
				query: {
					limit: params?.limit ?? 50,
					cursor: params?.cursor,
				},
			},
		},
	);

	return data;
}

export async function loadProjectMetricsAction(
	orgId: string,
	projectId: string,
	window: TokenWindow,
): Promise<ProjectMetrics | null> {
	return await getProjectMetrics(orgId, projectId, window);
}

export async function loadProjectLogsAction(
	orgId: string,
	projectId: string,
	cursor?: string,
): Promise<ProjectLogsResponse | null> {
	return await getProjectLogs(orgId, projectId, { cursor });
}
