import { redirect } from "next/navigation";

import DashboardShell from "@/app/dashboard/DashboardShell";
import { getDevPlanStatus, getUserMe } from "@/lib/server-api";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const [userData, devPlanStatus] = await Promise.all([
		getUserMe(),
		getDevPlanStatus(),
	]);

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard");
	}

	return (
		<DashboardShell initialUser={userData} initialDevPlanStatus={devPlanStatus}>
			{children}
		</DashboardShell>
	);
}
