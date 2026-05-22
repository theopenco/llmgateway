import SkillsPageClient from "@/components/playground/skills-page-client";
import { fetchServerData } from "@/lib/server-api";

import type { Organization } from "@/lib/types";

export default async function SkillsPage({
	searchParams,
}: {
	searchParams: Promise<{ id?: string }>;
}) {
	const [orgsData, params] = await Promise.all([
		fetchServerData<{ organizations: Organization[] }>("GET", "/orgs"),
		searchParams,
	]);

	const organizations = orgsData?.organizations ?? [];
	const selectedOrganization = organizations[0] ?? null;

	return (
		<SkillsPageClient
			selectedOrganization={selectedOrganization}
			initialSkillId={params.id ?? null}
		/>
	);
}
