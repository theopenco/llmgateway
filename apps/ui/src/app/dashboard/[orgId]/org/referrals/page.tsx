import { fetchServerData } from "@/lib/server-api";

import { ReferralsClient, type ReferralStats } from "./referrals-client";

import type { paths } from "@/lib/api/v1";

type ReferralStatsResponse =
	paths["/orgs/{id}/referral-stats"]["get"]["responses"][200]["content"]["application/json"];

async function fetchReferralStats(orgId: string): Promise<ReferralStats> {
	const data = await fetchServerData<Partial<ReferralStatsResponse>>(
		"GET",
		"/orgs/{id}/referral-stats",
		{
			params: {
				path: { id: orgId },
			},
		},
	);

	return {
		referredCount: data?.referredCount ?? 0,
		netPaidTopUps: data?.netPaidTopUps ?? "0",
		minNetTopUps: data?.minNetTopUps ?? null,
		eligible: data?.eligible ?? false,
	};
}

export default async function ReferralsPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;

	if (!orgId) {
		return (
			<div className="flex flex-col">
				<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
					<div className="flex items-center justify-between">
						<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
							Referrals
						</h2>
					</div>
					<div className="text-center py-8 text-muted-foreground">
						No organization selected
					</div>
				</div>
			</div>
		);
	}

	const stats = await fetchReferralStats(orgId);

	return (
		<ReferralsClient
			netPaidTopUps={stats.netPaidTopUps}
			minNetTopUps={stats.minNetTopUps}
			eligible={stats.eligible}
			referredCount={stats.referredCount}
		/>
	);
}
