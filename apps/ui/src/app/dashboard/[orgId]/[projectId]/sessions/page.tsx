import { redirect } from "next/navigation";

export default async function SessionsPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;
	redirect(`/dashboard/${orgId}/${projectId}/agents`);
}
