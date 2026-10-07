import { redirect } from "next/navigation";

import { getOrganizations } from "@/lib/server-api";

export default async function DashboardReferralsRedirectPage() {
	const data = await getOrganizations();
	const orgId = data?.organizations?.[0]?.id;

	if (!orgId) {
		redirect("/onboarding");
	}

	redirect(`/dashboard/${orgId}/org/referrals`);
}
