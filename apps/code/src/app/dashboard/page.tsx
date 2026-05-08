import { redirect } from "next/navigation";

import { fetchServerData } from "@/lib/server-api";

import DashboardClient from "./DashboardClient";

export default async function Dashboard() {
	const userData = await fetchServerData<{ user: { id: string } } | null>(
		"GET",
		"/user/me",
	);

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard");
	}

	return <DashboardClient />;
}
