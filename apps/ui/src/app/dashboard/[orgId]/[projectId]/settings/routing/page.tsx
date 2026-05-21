import { RoutingConfigClient } from "./_components/routing-config-client";

export default async function RoutingPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { projectId } = await params;
	return <RoutingConfigClient projectId={projectId} />;
}
