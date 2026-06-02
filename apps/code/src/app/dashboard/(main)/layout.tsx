import { redirect } from "next/navigation";

import DashboardShell from "@/app/dashboard/DashboardShell";
import { fetchServerData } from "@/lib/server-api";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const userData = await fetchServerData<{ user: { id: string } } | null>(
		"GET",
		"/user/me",
	);

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard");
	}

	return <DashboardShell>{children}</DashboardShell>;
}
