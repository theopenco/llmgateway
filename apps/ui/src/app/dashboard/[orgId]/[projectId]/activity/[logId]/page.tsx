import { fetchServerData } from "@/lib/server-api";

import { LogDetailClient } from "./log-detail-client";

import type { LogDetailData } from "@/types/activity";

export default async function LogDetailPage({
	params,
}: {
	params: Promise<{ orgId: string; projectId: string; logId: string }>;
}) {
	const { orgId, projectId, logId } = await params;

	const initialData = await fetchServerData<LogDetailData>(
		"GET",
		"/logs/{id}",
		{
			params: {
				path: { id: logId },
			},
		},
	);

	return (
		<LogDetailClient
			initialData={initialData}
			orgId={orgId}
			projectId={projectId}
			logId={logId}
		/>
	);
}
