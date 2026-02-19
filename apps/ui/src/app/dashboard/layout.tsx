import { redirect } from "next/navigation";

import { getUser } from "@/lib/getUser";

import type { ReactNode } from "react";

interface DashboardLayoutProps {
	children: ReactNode;
}

export default async function DashboardLayout({
	children,
}: DashboardLayoutProps) {
	const user = await getUser();

	if (!user) {
		return redirect("/login");
	}

	return await children;
}
