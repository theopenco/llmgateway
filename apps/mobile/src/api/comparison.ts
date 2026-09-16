import { chatContext } from "@/api/chat-context";
import {
	completionMessage,
	readChat,
	storedAttachments,
} from "@/api/chat-messages";
import { client } from "@/api/client";
import { rememberProjectExchange } from "@/api/project-memory";
import { generateReply, saveReply } from "@/api/reply";

import type { Attachment } from "@/api/chat-messages";
import type { Reply } from "@/api/reply";
import type { ChatSettings } from "@/lib/preferences";

export interface ComparisonPanel {
	id: string;
	model: string;
}

export async function loadComparison(id: string) {
	const root = await client.GET("/chats/{id}", { params: { path: { id } } });
	if (!root.data) {
		throw new Error("Could not load this comparison.");
	}
	const children = await Promise.all(
		root.data.comparisonChatIds.map(async (childId) => {
			const child = await client.GET("/chats/{id}", {
				params: { path: { id: childId } },
			});
			if (!child.data) {
				throw new Error("Could not load a comparison panel.");
			}
			return readChat(child.data);
		}),
	);
	return [readChat(root.data), ...children];
}

export async function createComparison({
	models,
	panels,
	organizationId,
	title,
	onCreated,
}: {
	models: string[];
	panels: ComparisonPanel[];
	organizationId: string;
	title: string;
	onCreated: (panels: ComparisonPanel[]) => void;
}) {
	if (models.length < 2 || models.length > 3) {
		throw new Error("Choose two or three models to compare.");
	}
	const created = [...panels];
	for (const model of models.slice(created.length)) {
		const result = await client.POST("/chats", {
			body: {
				title: title.slice(0, 200),
				model,
				organizationId,
				comparisonEnabled: created.length === 0,
				parentChatId: created[0]?.id,
			},
		});
		if (!result.data) {
			throw new Error("Could not create this comparison panel.");
		}
		created.push({ id: result.data.chat.id, model });
		onCreated([...created]);
	}
	return created;
}

export async function completeComparisonPanel({
	panel,
	projectId,
	prompt,
	attachments,
	settings,
	signal,
	onReply,
	onSaved,
	retry = false,
}: {
	panel: ComparisonPanel;
	projectId: string;
	prompt: string;
	attachments: Attachment[];
	settings: ChatSettings;
	signal: AbortSignal;
	onReply: (reply: Reply) => void;
	onSaved: () => void;
	retry?: boolean;
}) {
	const saved = await client.GET("/chats/{id}", {
		params: { path: { id: panel.id } },
	});
	if (!saved.data) {
		throw new Error("Could not load the model's conversation.");
	}
	const history = readChat(saved.data);
	const userIndex = history.messages
		.map((message) => message.role)
		.lastIndexOf("user");
	const user = retry ? history.messages[userIndex] : undefined;
	if (retry && !user) {
		throw new Error("Send a message before retrying this model.");
	}
	const content = user?.content ?? prompt.trim();
	const files = user?.attachments ?? attachments;
	const context = await chatContext(
		content,
		projectId,
		history.chat.projectId ?? undefined,
	);
	if (signal.aborted) {
		return;
	}
	await client.PATCH("/chats/{id}", {
		params: { path: { id: panel.id } },
		body: { model: panel.model, webSearch: settings.webSearch },
	});
	if (!retry) {
		await client.POST("/chats/{id}/messages", {
			params: { path: { id: panel.id } },
			body: {
				role: "user",
				...(content && { content }),
				...storedAttachments(files),
			},
		});
	}
	const system = [settings.systemPrompt, context].filter(Boolean).join("\n\n");
	const previous = retry
		? history.messages.slice(0, userIndex)
		: history.messages;
	const reply = await generateReply({
		projectId,
		model: panel.model,
		settings,
		signal,
		messages: [
			...(system ? [{ role: "system" as const, content: system }] : []),
			...previous.map((message) =>
				completionMessage(
					message.role,
					message.content ?? "",
					message.attachments,
				),
			),
			completionMessage("user", content, files),
		],
		onReply,
	});
	const lastAssistant = retry
		? history.messages
				.slice(userIndex + 1)
				.find((message) => message.role === "assistant")
		: undefined;
	onReply(reply);
	await saveReply(panel.id, reply, lastAssistant?.id);
	void rememberProjectExchange({
		knowledgeProjectId: history.chat.projectId,
		billingProjectId: projectId,
		userMessage: content,
		reply,
		aborted: signal.aborted,
	});
	onSaved();
	if (reply.error && !signal.aborted) {
		throw reply.error;
	}
}
