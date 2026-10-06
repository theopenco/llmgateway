import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CompanyProvider } from "@/components/dashboard/company-context";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getUserMe } from "@/lib/server-api";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Operations",
	robots: { index: false, follow: false },
};

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const me = await getUserMe();
	if (!me?.user) {
		redirect("/login?returnUrl=/dashboard");
	}
	const cookieStore = await cookies();
	const sidebarOpen =
		cookieStore.get("airside_sidebar_state")?.value !== "false";

	return (
		<CompanyProvider>
			<DashboardShell defaultSidebarOpen={sidebarOpen}>
				{children}
			</DashboardShell>
		</CompanyProvider>
	);
}
