import { ModelUsageClient } from "@/components/usage/model-usage-client";

export default async function ModelUsagePage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string }>;
}) {
	const { projectId } = await params;

	return <ModelUsageClient projectId={projectId} />;
}
