import { UsageClient } from "@/components/usage/usage-client";

export default async function UsagePage({
	params,
}: {
	params?: Promise<{
		projectId?: string;
	}>;
}) {
	const paramsData = await params;
	const projectId = paramsData?.projectId;

	return <UsageClient projectId={projectId} />;
}
