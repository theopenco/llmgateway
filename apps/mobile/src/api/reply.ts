import { client } from "@/api/client";
import { streamCompletion } from "@/api/completion";
import { mergeSources } from "@/api/sources";

import type { Message } from "@/api/completion";
import type { Source } from "@/api/sources";
import type { ChatSettings } from "@/lib/preferences";

export interface Reply {
	model: string;
	content: string;
	reasoning: string;
	sources: Source[];
	error?: Error;
}

export async function generateReply({
	projectId,
	model,
	messages,
	settings,
	signal,
	onReply,
}: {
	projectId: string;
	model: string;
	messages: Message[];
	settings: ChatSettings;
	signal: AbortSignal;
	onReply: (reply: Reply) => void;
}): Promise<Reply> {
	let reply: Reply = { model, content: "", reasoning: "", sources: [] };
	try {
		await streamCompletion({
			projectId,
			model,
			messages,
			settings,
			signal,
			onDelta: (delta) => {
				reply = {
					...reply,
					content: reply.content + delta.content,
					reasoning: reply.reasoning + delta.reasoning,
					sources: mergeSources(reply.sources, delta.sources ?? []),
				};
				onReply(reply);
			},
		});
	} catch (error) {
		reply.error =
			error instanceof Error
				? error
				: new Error("The response failed. Please try again.");
	}
	if (!reply.content && !reply.reasoning) {
		reply.content = signal.aborted
			? "Response stopped."
			: "The response ended before any content arrived.";
	}
	return reply;
}

export async function saveReply(
	chatId: string,
	reply: Reply,
	messageId?: string,
) {
	await client.POST("/chats/{id}/messages", {
		params: { path: { id: chatId } },
		body: {
			id: messageId,
			role: "assistant",
			...(reply.content && { content: reply.content }),
			...(reply.reasoning && { reasoning: reply.reasoning }),
			...(reply.sources.length && { sources: JSON.stringify(reply.sources) }),
			metadata: { model: reply.model, interrupted: !!reply.error },
		},
	});
}
