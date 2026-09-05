import ProjectsPageClient from "@/components/playground/projects-page-client";
import { fetchServerData } from "@/lib/server-api";

import type { Organization } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Projects",
	robots: { index: false, follow: false },
};

export default async function ProjectsPage({
	searchParams,
}: {
	searchParams: Promise<{ id?: string; orgId?: string }>;
}) {
	const [orgsData, params] = await Promise.all([
		fetchServerData<{ organizations: Organization[] }>("GET", "/orgs"),
		searchParams,
	]);

	const organizations = orgsData?.organizations ?? [];
	// Match the chat page's org context: an explicit ?orgId= selects a
	// dashboard org, otherwise the default "Chat plan" context applies.
	const selectedOrganization =
		organizations.find((org) => org.id === params.orgId) ?? null;

	return (
		<ProjectsPageClient
			selectedOrganization={selectedOrganization}
			initialProjectId={params.id ?? null}
		/>
	);
}
