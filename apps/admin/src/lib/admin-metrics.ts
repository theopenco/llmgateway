import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface AdminDashboardMetrics {
	totalCreditsIssued: number;
	totalRevenue: number;
	netProfit: number;
	totalSignups: number;
	verifiedUsers: number;
	payingCustomers: number;
	revenuePerCustomerPerMonth: number;
	peakLoadSuccessRate: number;
	customerInfraReplacementRate: number;
}

export async function getAdminDashboardMetrics(): Promise<AdminDashboardMetrics | null> {
	const cookieStore = await cookies();
	const key = "better-auth.session_token";
	const sessionCookie = cookieStore.get(key);
	const secureSessionCookie = cookieStore.get(`__Secure-${key}`);

	if (!sessionCookie && !secureSessionCookie) {
		return null;
	}

	const data = await fetchServerData<AdminDashboardMetrics>(
		"GET",
		"/admin/metrics",
	);

	return data;
}
