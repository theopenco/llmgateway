import { gatewayClient } from "@/api/gateway";

import type { operations } from "@/lib/api/gateway";
import type { paths } from "@/lib/api/v1";

export type VideoRequest = NonNullable<
	operations["v1_videos_create"]["requestBody"]
>["content"]["application/json"];
export type VideoHistoryItem =
	paths["/playground/video-history"]["get"]["responses"][200]["content"]["application/json"]["items"][number];
export type VideoResult = VideoHistoryItem["models"][number];
export type VideoGeneration = NonNullable<
	paths["/playground/video-history"]["post"]["requestBody"]
>["content"]["application/json"];

export async function createVideo(
	projectId: string,
	request: VideoRequest & { model: string },
): Promise<VideoResult> {
	try {
		const gateway = await gatewayClient(projectId, request.model);
		const { data } = await gateway.POST("/v1/videos", { body: request });
		if (!data?.id) {
			throw new Error("The provider did not return a video job.");
		}
		return {
			modelId: request.model,
			modelName: request.model,
			jobId: data.id,
			videoUrl: null,
		};
	} catch (error) {
		return {
			modelId: request.model,
			modelName: request.model,
			jobId: null,
			videoUrl: null,
			error:
				error instanceof Error ? error.message : "Video generation failed.",
		};
	}
}
