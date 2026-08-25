import { redirect } from "next/navigation";

import { CompanyProvider } from "@/components/dashboard/company-context";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { getUserMe } from "@/lib/server-api";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const me = await getUserMe();
	if (!me?.user) {
		redirect("/login?returnUrl=/dashboard");
	}

	return (
		<CompanyProvider>
			<DashboardShell>{children}</DashboardShell>
		</CompanyProvider>
	);
}
