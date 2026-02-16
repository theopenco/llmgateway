import { cookies } from "next/headers";

import { fetchServerData } from "./server-api";

export interface AdminDashboardMetrics {
	totalSignups: number;
	verifiedUsers: number;
	payingCustomers: number;
	totalRevenue: number;
	totalOrganizations: number;
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
