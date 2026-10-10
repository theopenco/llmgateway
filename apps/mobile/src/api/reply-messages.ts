import { readToolParts } from "@/api/tool-parts";

import type { ChatMessage } from "@/api/chat-messages";
import type { Reply } from "@/api/reply";

export function messageReply(message: ChatMessage, model: string): Reply {
	return {
		model,
		content: message.content ?? "",
		reasoning: message.reasoning ?? "",
		sources: message.sourceLinks ?? [],
		tools: message.toolParts ?? readToolParts(message.tools),
	};
}
export function withReply(message: ChatMessage, reply: Reply): ChatMessage {
	return {
		...message,
		content: reply.content,
		reasoning: reply.reasoning,
		sourceLinks: reply.sources,
		sources: JSON.stringify(reply.sources),
		tools: JSON.stringify(reply.tools ?? []),
		toolParts: reply.tools ?? [],
		metadata: {
			...(message.metadata ?? {}),
			model: reply.model,
			interrupted: !!reply.error,
			toolContinuation: !!reply.toolContinuation,
		},
	};
}
