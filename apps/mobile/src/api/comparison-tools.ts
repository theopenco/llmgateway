import { chatContext } from "@/api/chat-context";
import { readChat } from "@/api/chat-messages";
import { client } from "@/api/client";
import { generateLoungeReply, loungeMessage } from "@/api/lounge-completion";
import { rememberProjectExchange } from "@/api/project-memory";
import { saveReply } from "@/api/reply";
import { messageReply, withReply } from "@/api/reply-messages";
import { answerToolCall, pendingTool } from "@/api/tool-parts";

import type { ChatMessage } from "@/api/chat-messages";
import type { Reply } from "@/api/reply";
import type { ChatSettings } from "@/lib/preferences";

export interface ComparisonToolAnswer {
	messageId: string;
	toolCallId: string;
	approved: boolean;
}

export async function continueComparison({
	chatId,
	projectId,
	settings,
	answer,
	signal,
	onStored,
	onReply,
}: {
	chatId: string;
	projectId: string;
	settings: ChatSettings;
	answer?: ComparisonToolAnswer;
	signal: AbortSignal;
	onStored: (message: ChatMessage) => void;
	onReply: (reply: Reply, messageId: string) => void;
}) {
	const result = await client.GET("/chats/{id}", {
		params: { path: { id: chatId } },
		signal,
	});
	if (!result.data) {
		throw new Error("Could not load the primary conversation.");
	}
	const history = readChat(result.data);
	if (!history.chat.comparisonEnabled) {
		throw new Error(
			"Connector requests belong to the primary comparison model.",
		);
	}
	if (history.chat.status === "archived") {
		throw new Error("Restore this comparison before continuing.");
	}
	let messages = history.messages;
	const model = history.chat.model;
	const persist = async (message: ChatMessage, reply: Reply) => {
		await saveReply(chatId, reply, message.id);
		const stored = withReply(message, reply);
		messages = messages.map((item) => (item.id === stored.id ? stored : item));
		onStored(stored);
	};
	if (answer) {
		const message = messages.find((item) => item.id === answer.messageId);
		if (!message || message.role !== "assistant") {
			throw new Error("Reload this comparison before answering the request.");
		}
		await answerToolCall({
			parts: message.toolParts ?? [],
			toolCallId: answer.toolCallId,
			approved: answer.approved,
			signal,
			persist: (parts) =>
				persist(message, {
					...messageReply(message, model),
					tools: parts,
					toolContinuation: true,
				}),
		});
	}
	if (messages.some((message) => message.toolParts?.some(pendingTool))) {
		return;
	}
	const last = messages.at(-1);
	const user = [...messages]
		.reverse()
		.find((message) => message.role === "user");
	if (
		!last ||
		last.role !== "assistant" ||
		!user ||
		last.metadata?.toolContinuation !== true
	) {
		throw new Error("There is no interrupted tool response to continue.");
	}
	signal.throwIfAborted();
	const context = await chatContext(
		user.content ?? "",
		projectId,
		history.chat.projectId ?? undefined,
	);
	const system = [settings.systemPrompt, context].filter(Boolean).join("\n\n");
	const reply = await generateLoungeReply({
		projectId,
		model,
		settings,
		signal,
		initial: messageReply(last, model),
		messages: [
			...(system
				? [
						{
							id: "system",
							role: "system" as const,
							parts: [{ type: "text", text: system }],
						},
					]
				: []),
			...messages.map(loungeMessage),
		],
		onReply: (value) => onReply(value, last.id),
	});
	onReply(reply, last.id);
	await persist(last, reply);
	void rememberProjectExchange({
		knowledgeProjectId: history.chat.projectId,
		billingProjectId: projectId,
		userMessage: user.content ?? "",
		reply,
		aborted: signal.aborted,
	});
	if (reply.error && !signal.aborted) {
		throw reply.error;
	}
}
