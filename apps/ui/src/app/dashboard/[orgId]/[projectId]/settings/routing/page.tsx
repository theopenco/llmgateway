import { RoutingConfigClient } from "./_components/routing-config-client";

export default async function RoutingPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { orgId, projectId } = await params;
	return <RoutingConfigClient orgId={orgId} projectId={projectId} />;
}
