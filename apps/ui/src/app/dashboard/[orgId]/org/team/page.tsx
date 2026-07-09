import { fetchServerData } from "@/lib/server-api";

import { TeamClient } from "./team-client";

import type { TeamMembersData } from "@/hooks/useTeam";

export default async function TeamPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;

	const initialData = await fetchServerData<TeamMembersData>(
		"GET",
		"/team/{organizationId}/members",
		{
			params: {
				path: {
					organizationId: orgId,
				},
			},
		},
	);

	return <TeamClient initialData={initialData ?? undefined} />;
}
