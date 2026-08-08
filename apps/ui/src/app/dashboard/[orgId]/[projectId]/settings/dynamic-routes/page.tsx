import { DynamicRoutesClient } from "./_components/dynamic-routes-client";

export default async function DynamicRoutesPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { projectId } = await params;
	return <DynamicRoutesClient projectId={projectId} />;
}
