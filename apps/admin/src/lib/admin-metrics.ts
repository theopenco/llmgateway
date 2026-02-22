import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface AdminDashboardMetrics {
	totalSignups: number;
	verifiedUsers: number;
	payingCustomers: number;
	totalRevenue: number;
	totalOrganizations: number;
	totalToppedUp: number;
	totalSpent: number;
	unusedCredits: number;
	overage: number;
}

export type TimeseriesRange = "7d" | "30d" | "90d" | "365d" | "all";

export interface TimeseriesDataPoint {
	date: string;
	signups: number;
	paidCustomers: number;
	revenue: number;
}

export interface AdminTimeseriesMetrics {
	range: TimeseriesRange;
	data: TimeseriesDataPoint[];
	totals: {
		signups: number;
		paidCustomers: number;
		revenue: number;
	};
}

async function hasSession(): Promise<boolean> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);
	return !!(sessionCookie || secureSessionCookie);
}

export async function getAdminDashboardMetrics(
	range: TimeseriesRange = "all",
): Promise<AdminDashboardMetrics | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<AdminDashboardMetrics>(
		"GET",
		"/admin/metrics" as "/admin/metrics",
		{ params: { query: { range } } },
	);

	return data;
}

export async function getAdminTimeseriesMetrics(
	range: TimeseriesRange = "all",
): Promise<AdminTimeseriesMetrics | null> {
	if (!(await hasSession())) {
		return null;
	}

	const data = await fetchServerData<AdminTimeseriesMetrics>(
		"GET",
		"/admin/metrics/timeseries" as "/admin/metrics/timeseries",
		{ params: { query: { range } } },
	);

	return data;
}
