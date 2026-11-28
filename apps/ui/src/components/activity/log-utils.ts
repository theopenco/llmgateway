import type { paths } from "@/lib/api/v1";
import type { Log } from "@llmgateway/db";

export type ApiLog =
	paths["/logs"]["get"]["responses"][200]["content"]["application/json"]["logs"][number];

export function toUiLog(log: ApiLog): Partial<Log> {
	return {
		...log,
		createdAt: new Date(log.createdAt),
		updatedAt: new Date(log.updatedAt),
		lastVideoDownloadedAt: log.lastVideoDownloadedAt
			? new Date(log.lastVideoDownloadedAt)
			: null,
		videoDownloadCount: log.videoDownloadCount ?? undefined,
		toolChoice: log.toolChoice as Log["toolChoice"],
		customHeaders: log.customHeaders as Log["customHeaders"],
	};
}
