import { OrganizationSkills } from "@/components/skills/organization-skills";

export default async function OrganizationSkillsPage({
	params,
}: {
	params: Promise<{ orgId: string }>;
}) {
	const { orgId } = await params;
	return <OrganizationSkills organizationId={orgId} />;
}
