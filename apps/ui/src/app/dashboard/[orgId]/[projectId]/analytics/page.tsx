import { AnalyticsClient } from "@/components/analytics/analytics-client";

export default async function AnalyticsPage({
	params,
}: {
	params?: Promise<{
		projectId?: string;
	}>;
}) {
	const paramsData = await params;
	const projectId = paramsData?.projectId;

	return <AnalyticsClient projectId={projectId} />;
}
