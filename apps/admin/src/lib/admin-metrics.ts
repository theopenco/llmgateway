import { fetchServerData } from "./server-api";

export interface AdminDashboardMetrics {
	totalCreditsIssued: number;
	totalRevenue: number;
	netProfit: number;
	totalSignups: number;
	verifiedUsers: number;
	payingCustomers: number;
}

export async function getAdminDashboardMetrics(): Promise<AdminDashboardMetrics | null> {
	const data = await fetchServerData<AdminDashboardMetrics>(
		"GET",
		"/admin/metrics",
	);

	return data;
}
