import { redirect } from "next/navigation";

import { getAuthPagePath } from "@/lib/auth-redirect";
import { getOrganizations } from "@/lib/server-api";

import type { Route } from "next";

const REFERRALS_PATH = "/dashboard/referrals";

export default async function DashboardReferralsRedirectPage() {
	const data = await getOrganizations();
	const orgId = data?.organizations?.[0]?.id;

	if (!orgId) {
		redirect(getAuthPagePath("/onboarding", REFERRALS_PATH) as Route);
	}

	redirect(`/dashboard/${orgId}/org/referrals`);
}
