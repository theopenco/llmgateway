import { client, queryClient } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";

import type { Reply } from "@/api/reply";

export async function rememberProjectExchange({
	knowledgeProjectId,
	billingProjectId,
	userMessage,
	reply,
	temporary = false,
	aborted = false,
}: {
	knowledgeProjectId?: string | null;
	billingProjectId: string;
	userMessage: string;
	reply: Reply;
	temporary?: boolean;
	aborted?: boolean;
}) {
	if (
		!knowledgeProjectId ||
		temporary ||
		aborted ||
		reply.error ||
		!userMessage.trim() ||
		!reply.content.trim()
	) {
		return;
	}
	try {
		const token = await ensureGatewayKey(billingProjectId);
		const { data } = await client.POST("/chat-projects/{id}/memories/extract", {
			params: { path: { id: knowledgeProjectId } },
			body: {
				userMessage: userMessage.slice(0, 8000),
				assistantMessage: reply.content.slice(0, 8000),
			},
			headers: { "x-llmgateway-key": token },
			signal: AbortSignal.timeout(90_000),
		});
		if (!data) {
			throw new Error("The project memory response was not returned.");
		}
		await queryClient.invalidateQueries({
			queryKey: [
				"get",
				"/chat-projects/{id}/memories",
				{ params: { path: { id: knowledgeProjectId } } },
			],
		});
	} catch (error) {
		// Memory learning is best effort; keep the saved reply and existing memories.
		// eslint-disable-next-line no-console -- This background task can finish after navigation.
		console.warn("Could not update project memory", error);
	}
}
