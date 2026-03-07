"use server";

import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

import type { TokenWindow } from "./admin-organizations";
import type { CostByModelData } from "@/components/cost-by-model-chart";
import type {
	HistoryDataPoint,
	HistoryWindow,
} from "@/components/history-chart";

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	return !!(sessionCookie ?? secureSessionCookie);
}

interface HistoryResponse {
	data: HistoryDataPoint[];
}

export async function getProviderHistory(
	providerId: string,
	window: HistoryWindow,
): Promise<HistoryDataPoint[] | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<HistoryResponse>(
		"GET",
		`/admin/providers/${providerId}/history` as "/admin/providers",
		{
			params: {
				query: { window },
			},
		},
	);

	return data?.data ?? null;
}

export async function getModelHistory(
	modelId: string,
	window: HistoryWindow,
): Promise<HistoryDataPoint[] | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<HistoryResponse>(
		"GET",
		`/admin/models/${encodeURIComponent(modelId)}/history` as "/admin/models",
		{
			params: {
				query: { window },
			},
		},
	);

	return data?.data ?? null;
}

export async function getMappingHistory(
	providerId: string,
	modelId: string,
	window: HistoryWindow,
): Promise<HistoryDataPoint[] | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<HistoryResponse>(
		"GET",
		`/admin/providers/${providerId}/models/${encodeURIComponent(modelId)}/history` as "/admin/providers",
		{
			params: {
				query: { window },
			},
		},
	);

	return data?.data ?? null;
}

export async function getGlobalCostByModel(
	window: TokenWindow,
): Promise<CostByModelData | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<CostByModelData>(
		"GET",
		"/admin/metrics/cost-by-model" as "/admin/metrics",
		{
			params: {
				query: { window },
			},
		},
	);

	return data;
}

export async function getOrgCostByModel(
	orgId: string,
	window: TokenWindow,
): Promise<CostByModelData | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<CostByModelData>(
		"GET",
		`/admin/organizations/${orgId}/cost-by-model` as "/admin/organizations/{orgId}",
		{
			params: {
				path: { orgId },
				query: { window },
			},
		},
	);

	return data;
}
