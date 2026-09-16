import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	Alert,
	FlatList,
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	Switch,
	Text,
	TextInput,
	View,
	useColorScheme,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chatContext } from "@/api/chat-context";
import { refreshChatHistory } from "@/api/chat-history";
import {
	completionMessage,
	readChat,
	storedAttachments,
} from "@/api/chat-messages";
import { api, client, queryClient } from "@/api/client";
import { generateLoungeReply, loungeMessage } from "@/api/lounge-completion";
import { rememberProjectExchange } from "@/api/project-memory";
import { saveReply } from "@/api/reply";
import { messageReply, withReply } from "@/api/reply-messages";
import { answerToolCall, pendingTool, readToolParts } from "@/api/tool-parts";
import { ChatSettings } from "@/components/ChatSettings";
import { ChatSharing } from "@/components/ChatSharing";
import { Markdown } from "@/components/Markdown";
import { MessageBubble } from "@/components/MessageBubble";
import { ModelPicker } from "@/components/ModelPicker";
import { Sources } from "@/components/Sources";
import { ToolCalls } from "@/components/ToolCalls";
import {
	Button,
	colors,
	ErrorNotice,
	Field,
	Screen,
	styles,
} from "@/components/ui";
import { pickChatAttachment } from "@/lib/chat-files";
import { defaultChatSettings, usePreferences } from "@/lib/preferences";
import { useFollowingList } from "@/lib/use-following-list";

import type { Attachment, ChatMessage } from "@/api/chat-messages";
import type { Source } from "@/api/sources";
import type { ToolPart } from "@/api/tool-parts";

let localSequence = 0;
function localMessage(
	role: ChatMessage["role"],
	content: string,
	attachments: Attachment[],
	reasoning = "",
	sourceLinks: Source[] = [],
	toolParts: ToolPart[] = [],
): ChatMessage {
	return {
		id: `local-${Date.now()}-${++localSequence}`,
		role,
		content,
		attachments,
		sourceLinks,
		reasoning,
		images: null,
		audios: null,
		documents: null,
		tools: JSON.stringify(toolParts),
		toolParts,
		sources: null,
		metadata: null,
		sequence: 0,
		createdAt: new Date().toISOString(),
	};
}
interface ToolAction {
	messageId?: string;
	toolCallId?: string;
	approved?: boolean;
}
interface SendAction {
	kind: "send" | "retry" | "edit";
	messageId?: string;
	content?: string;
}

export function Chat({
	chatId,
	organizationId,
	projectId,
	knowledgeProjectId,
}: {
	chatId?: string;
	organizationId: string;
	projectId: string;
	knowledgeProjectId?: string;
}) {
	const scheme = useColorScheme();
	const insets = useSafeAreaInsets();
	const [id, setId] = useState(chatId);
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [selectedModel, setSelectedModel] = useState<string>();
	const [selectedWebSearch, setSelectedWebSearch] = useState<boolean>();
	const [temporary, setTemporary] = useState(false);
	const [temporaryMessages, setTemporaryMessages] = useState<ChatMessage[]>([]);
	const [toolMessages, setToolMessages] = useState<Record<string, ChatMessage>>(
		{},
	);
	const [draft, setDraft] = useState("");
	const [reasoning, setReasoning] = useState("");
	const [draftSources, setDraftSources] = useState<Source[]>([]);
	const [draftTools, setDraftTools] = useState<ToolPart[]>([]);
	const [continuingId, setContinuingId] = useState<string>();
	const toolLock = useRef(false);
	const [editing, setEditing] = useState<ChatMessage>();
	const [editText, setEditText] = useState("");
	const controllerRef = useRef<AbortController | null>(null);
	const following = useFollowingList<ChatMessage>();
	const preferences = usePreferences();
	const chat = api.useQuery(
		"get",
		"/chats/{id}",
		{ params: { path: { id: id ?? "" } } },
		{
			enabled: !!id,
			select: readChat,
		},
	);
	const messages = temporary
		? temporaryMessages
		: (chat.data?.messages ?? []).map(
				(message) => toolMessages[message.id] ?? message,
			);
	const hasPendingTools = messages.some((message) =>
		(message.toolParts ?? readToolParts(message.tools)).some(pendingTool),
	);
	const model = selectedModel ?? chat.data?.chat.model ?? "auto";
	const currentProject = chat.data
		? (chat.data.chat.projectId ?? undefined)
		: knowledgeProjectId;
	const project = api.useQuery(
		"get",
		"/chat-projects/{id}",
		{
			params: { path: { id: currentProject ?? "" } },
		},
		{ enabled: !!currentProject },
	);
	const baseSettings = preferences.data?.chat ?? defaultChatSettings;
	const settings = {
		...baseSettings,
		webSearch:
			selectedWebSearch ?? chat.data?.chat.webSearch ?? baseSettings.webSearch,
	};
	useEffect(() => () => controllerRef.current?.abort(), []);
	const refresh = async () => {
		await refreshChatHistory();
		await queryClient.invalidateQueries({ queryKey: ["comparison-session"] });
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats/{id}"] });
		if (currentProject) {
			await queryClient.invalidateQueries({
				queryKey: ["get", "/chat-projects"],
			});
			await queryClient.invalidateQueries({
				queryKey: ["get", "/chat-projects/{id}"],
			});
		}
	};
	const send = useMutation({
		mutationFn: async (action: SendAction) => {
			if (toolLock.current) {
				return;
			}
			const previous = messages;
			const userIndex =
				action.kind === "edit"
					? previous.findIndex((message) => message.id === action.messageId)
					: previous.map((message) => message.role).lastIndexOf("user");
			const user = action.kind === "send" ? undefined : previous[userIndex];
			const content =
				action.kind === "edit"
					? (action.content?.trim() ?? "")
					: action.kind === "retry"
						? (user?.content ?? "")
						: prompt.trim();
			const files =
				action.kind === "send" ? attachments : (user?.attachments ?? []);
			if (!content && !files.length) {
				return;
			}
			if (action.kind !== "send" && (!user || user.role !== "user")) {
				throw new Error("Choose a user message to retry or edit.");
			}
			const prefix =
				action.kind === "send" ? previous : previous.slice(0, userIndex);
			const contextMessages = [
				...prefix.map((message) =>
					completionMessage(
						message.role,
						message.content ?? "",
						message.attachments,
					),
				),
				completionMessage("user", content, files),
			];
			const controller = new AbortController();
			controllerRef.current = controller;
			Keyboard.dismiss();
			following.startFollowing();
			setDraft("");
			setReasoning("");
			setDraftSources([]);
			setDraftTools([]);
			const context = await chatContext(
				content || files.map((file) => file.name).join(" "),
				projectId,
				currentProject,
			);
			const system = [settings.systemPrompt, context]
				.filter(Boolean)
				.join("\n\n");
			if (controller.signal.aborted) {
				return;
			}
			let currentId = id;
			if (!temporary) {
				if (!currentId) {
					const result = await client.POST("/chats", {
						body: {
							title: (content || files[0]?.name || "Conversation").slice(
								0,
								200,
							),
							model,
							webSearch: settings.webSearch,
							organizationId,
							projectId: currentProject,
						},
					});
					if (!result.data) {
						throw new Error("Could not create the conversation.");
					}
					currentId = result.data.chat.id;
					setId(currentId);
				} else {
					await client.PATCH("/chats/{id}", {
						params: { path: { id: currentId } },
						body: { model, webSearch: settings.webSearch },
					});
				}
				if (action.kind === "send") {
					await client.POST("/chats/{id}/messages", {
						params: { path: { id: currentId } },
						body: {
							role: "user",
							...(content && { content }),
							...storedAttachments(files),
						},
					});
				} else if (action.kind === "edit" && user) {
					await client.PATCH("/chats/{id}/messages/{messageId}", {
						params: { path: { id: currentId, messageId: user.id } },
						body: {
							content,
							images: user.images ?? undefined,
							audios: user.audios ?? undefined,
						},
					});
				}
			} else {
				setTemporaryMessages([...prefix, localMessage("user", content, files)]);
			}
			if (action.kind === "send") {
				setPrompt("");
				setAttachments([]);
			}
			setEditing(undefined);
			if (!temporary) {
				await refresh();
			}
			const reply = await generateLoungeReply({
				projectId,
				model,
				settings,
				plainMessages: [
					...(system ? [{ role: "system" as const, content: system }] : []),
					...contextMessages,
				],
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
					...prefix.map(loungeMessage),
					loungeMessage(localMessage("user", content, files)),
				],
				signal: controller.signal,
				onReply: (value) => {
					setDraftTools(value.tools ?? []);
					setDraftSources(value.sources);
					setDraft(value.content);
					setReasoning(value.reasoning);
				},
			});
			if (temporary) {
				setTemporaryMessages([
					...prefix,
					localMessage("user", content, files),
					localMessage(
						"assistant",
						reply.content,
						[],
						reply.reasoning,
						reply.sources,
						reply.tools,
					),
				]);
			} else if (currentId) {
				const lastAssistant =
					action.kind === "retry"
						? previous
								.slice(userIndex + 1)
								.find((message) => message.role === "assistant")
						: undefined;
				await saveReply(currentId, reply, lastAssistant?.id);
				if (lastAssistant) {
					setToolMessages((current) => ({
						...current,
						[lastAssistant.id]: withReply(lastAssistant, reply),
					}));
				}
				void rememberProjectExchange({
					knowledgeProjectId: currentProject,
					billingProjectId: projectId,
					userMessage: content,
					reply,
					aborted: controller.signal.aborted,
				});
			}
			setDraft("");
			setReasoning("");
			setDraftSources([]);
			setDraftTools([]);
			if (!temporary) {
				await refresh();
			}
			if (reply.error && !controller.signal.aborted) {
				throw reply.error;
			}
		},
	});
	const toolAction = useMutation({
		mutationFn: async (action: ToolAction) => {
			const controller = new AbortController();
			controllerRef.current = controller;
			let snapshot = messages;
			try {
				if (action.messageId && action.toolCallId) {
					const message = snapshot.find((item) => item.id === action.messageId);
					if (!message || message.role !== "assistant") {
						throw new Error(
							"Reload this conversation before answering the request.",
						);
					}
					await answerToolCall({
						parts: message.toolParts ?? readToolParts(message.tools),
						toolCallId: action.toolCallId,
						approved: action.approved === true,
						signal: controller.signal,
						persist: async (parts) => {
							const reply = {
								...messageReply(message, model),
								tools: parts,
								toolContinuation: true,
							};
							if (!temporary) {
								if (!id) {
									throw new Error("The conversation has not been saved.");
								}
								await saveReply(id, reply, message.id);
								setToolMessages((current) => ({
									...current,
									[message.id]: withReply(message, reply),
								}));
							}
							snapshot = snapshot.map((item) =>
								item.id === message.id ? withReply(item, reply) : item,
							);
							if (temporary) {
								setTemporaryMessages(snapshot);
							} else {
								await refresh();
							}
						},
					});
				}
				if (
					snapshot.some((message) =>
						(message.toolParts ?? readToolParts(message.tools)).some(
							pendingTool,
						),
					)
				) {
					return;
				}
				controller.signal.throwIfAborted();
				const user = [...snapshot]
					.reverse()
					.find((message) => message.role === "user");
				const last = snapshot.at(-1);
				if (!user || !last) {
					return;
				}
				const initial =
					last.role === "assistant" ? messageReply(last, model) : undefined;
				setContinuingId(initial ? last.id : undefined);
				setDraft(initial?.content ?? "");
				setReasoning(initial?.reasoning ?? "");
				setDraftSources(initial?.sources ?? []);
				setDraftTools(initial?.tools ?? []);
				following.startFollowing();
				const context = await chatContext(
					user.content ?? "",
					projectId,
					currentProject,
				);
				const system = [settings.systemPrompt, context]
					.filter(Boolean)
					.join("\n\n");
				const reply = await generateLoungeReply({
					projectId,
					model,
					settings,
					signal: controller.signal,
					initial,
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
						...snapshot.map(loungeMessage),
					],
					onReply: (value) => {
						setDraft(value.content);
						setReasoning(value.reasoning);
						setDraftSources(value.sources);
						setDraftTools(value.tools ?? []);
					},
				});
				if (temporary) {
					setTemporaryMessages(
						initial
							? snapshot.map((item) =>
									item.id === last.id ? withReply(item, reply) : item,
								)
							: [
									...snapshot,
									localMessage(
										"assistant",
										reply.content,
										[],
										reply.reasoning,
										reply.sources,
										reply.tools,
									),
								],
					);
				} else if (id) {
					await saveReply(id, reply, initial ? last.id : undefined);
					if (initial) {
						setToolMessages((current) => ({
							...current,
							[last.id]: withReply(last, reply),
						}));
					}
					await refresh();
					void rememberProjectExchange({
						knowledgeProjectId: currentProject,
						billingProjectId: projectId,
						userMessage: user.content ?? "",
						reply,
						aborted: controller.signal.aborted,
					});
				}
				if (reply.error && !controller.signal.aborted) {
					throw reply.error;
				}
			} finally {
				toolLock.current = false;
				setContinuingId(undefined);
				setDraft("");
				setReasoning("");
				setDraftSources([]);
				setDraftTools([]);
			}
		},
	});
	const answerTool = (action: ToolAction) => {
		if (toolLock.current || send.isPending || fork.isPending) {
			return;
		}
		toolLock.current = true;
		toolAction.mutate(action);
	};
	const attach = useMutation({
		mutationFn: async () => {
			const file = await pickChatAttachment();
			if (file) {
				setAttachments((current) => [...current, file]);
			}
		},
	});
	const update = api.useMutation("patch", "/chats/{id}", {
		onSuccess: refresh,
	});
	const fork = useMutation({
		mutationFn: async () => {
			if (!id) {
				return;
			}
			const result = await client.POST("/chats/{id}/fork", {
				params: { path: { id } },
			});
			if (!result.data) {
				throw new Error("Could not fork this conversation.");
			}
			setId(result.data.chat.id);
			await refresh();
		},
	});

	return (
		<KeyboardAvoidingView
			behavior="padding"
			keyboardVerticalOffset={insets.top + 44}
			style={styles.screen}
		>
			<View style={{ padding: 18, gap: 10 }}>
				<Text numberOfLines={1} style={styles.heading}>
					{temporary
						? "Temporary conversation"
						: (chat.data?.chat.title ?? "A fresh conversation")}
				</Text>
				<ModelPicker value={model} onChange={setSelectedModel} />
				<View style={[styles.row, { flexWrap: "wrap" }]}>
					<ChatSettings
						webSearch={settings.webSearch}
						onSaved={(value) => {
							setSelectedWebSearch(value.webSearch);
							if (id) {
								update.mutate({
									params: { path: { id } },
									body: { webSearch: value.webSearch },
								});
							}
						}}
					/>
					{!!id && (
						<Button
							title={chat.data?.chat.pinned ? "Unpin" : "Pin"}
							secondary
							onPress={() =>
								update.mutate({
									params: { path: { id } },
									body: { pinned: !chat.data?.chat.pinned },
								})
							}
						/>
					)}
				</View>
				{project.data?.project && (
					<Text style={styles.muted}>Project: {project.data.project.name}</Text>
				)}
				{!id && (
					<View style={styles.row}>
						<Text style={[styles.muted, { flex: 1 }]}>
							Keep out of Lounge history
						</Text>
						<Switch
							accessibilityLabel="Temporary conversation"
							value={temporary}
							disabled={!!messages.length || send.isPending}
							onValueChange={setTemporary}
						/>
					</View>
				)}
				{!!id && (
					<View style={styles.row}>
						<Button
							title="Rename"
							secondary
							disabled={send.isPending || toolAction.isPending}
							onPress={() =>
								Alert.prompt(
									"Rename conversation",
									undefined,
									(title) => {
										if (title.trim()) {
											update.mutate({
												params: { path: { id } },
												body: { title: title.trim().slice(0, 200) },
											});
										}
									},
									"plain-text",
									chat.data?.chat.title,
								)
							}
						/>
						<Button
							title="Fork"
							secondary
							disabled={send.isPending || toolAction.isPending}
							busy={fork.isPending}
							onPress={() => fork.mutate()}
						/>
						<ChatSharing
							chatId={id}
							organizationId={organizationId}
							publicShareId={chat.data?.chat.shareId}
							orgShares={chat.data?.chat.orgShares ?? []}
							disabled={send.isPending || fork.isPending}
						/>
					</View>
				)}
			</View>
			<FlatList
				{...following.listProps}
				data={messages}
				keyExtractor={(message) => message.id}
				contentContainerStyle={{ padding: 18, gap: 14 }}
				keyboardShouldPersistTaps="handled"
				ListEmptyComponent={
					<Text style={styles.muted}>
						Ask a question. Explore an idea. Make something new.
					</Text>
				}
				renderItem={({ item }) => (
					<MessageBubble
						message={
							continuingId === item.id
								? withReply(item, {
										model,
										content: draft,
										reasoning,
										sources: draftSources,
										tools: draftTools,
									})
								: item
						}
						onToolAnswer={(toolCallId, approved) =>
							answerTool({ messageId: item.id, toolCallId, approved })
						}
						busy={send.isPending || toolAction.isPending || fork.isPending}
						onEdit={
							item.role === "user"
								? () => {
										setEditText(item.content ?? "");
										setEditing(item);
									}
								: undefined
						}
					/>
				)}
				ListFooterComponent={
					!continuingId &&
					(draft || reasoning || draftSources.length || draftTools.length) ? (
						<View style={styles.card}>
							<Text style={styles.eyebrow}>THE LOUNGE</Text>
							{!!reasoning && (
								<Text selectable style={styles.muted}>
									{reasoning}
								</Text>
							)}
							{!!draft && <Markdown>{draft}</Markdown>}
							<ToolCalls parts={draftTools} busy />
							<Sources sources={draftSources} />
						</View>
					) : undefined
				}
			/>
			<View
				style={{
					padding: 16,
					paddingBottom: Math.max(16, insets.bottom),
					gap: 10,
				}}
			>
				<ErrorNotice
					error={
						send.error ??
						toolAction.error ??
						chat.error ??
						update.error ??
						fork.error ??
						attach.error ??
						preferences.error
					}
				/>
				{attachments.map((item) => (
					<View key={item.id} style={styles.row}>
						<Text numberOfLines={1} style={[styles.muted, { flex: 1 }]}>
							{item.name}
						</Text>
						<Button
							title={`Remove ${item.name}`}
							secondary
							onPress={() =>
								setAttachments((current) =>
									current.filter((file) => file.id !== item.id),
								)
							}
						/>
					</View>
				))}
				<TextInput
					aria-label="Message"
					placeholder="Ask anything…"
					placeholderTextColor={colors.muted}
					keyboardAppearance={scheme === "dark" ? "dark" : "light"}
					multiline
					value={prompt}
					onChangeText={setPrompt}
					style={[styles.input, { maxHeight: 140 }]}
				/>
				<View style={styles.row}>
					<Button
						title="Attach file"
						secondary
						disabled={
							send.isPending || toolAction.isPending || attachments.length >= 4
						}
						busy={attach.isPending}
						onPress={() => attach.mutate()}
					/>
					{send.isPending || toolAction.isPending ? (
						<Button
							title="Stop response"
							secondary
							onPress={() => controllerRef.current?.abort()}
						/>
					) : (
						<Button
							title="Send message"
							onPress={() => send.mutate({ kind: "send" })}
							disabled={
								hasPendingTools ||
								(!prompt.trim() && !attachments.length) ||
								preferences.isPending ||
								!!preferences.error ||
								fork.isPending ||
								(!!id && (chat.isPending || !!chat.error))
							}
						/>
					)}
				</View>
				{hasPendingTools && (
					<Text style={styles.muted}>
						Review the tool requests above to continue.
					</Text>
				)}
				{!hasPendingTools &&
					!send.isPending &&
					!toolAction.isPending &&
					messages.at(-1)?.metadata?.toolContinuation === true && (
						<Button
							title="Continue response"
							secondary
							onPress={() => answerTool({})}
						/>
					)}
				{!send.isPending &&
					!toolAction.isPending &&
					messages.some((message) => message.role === "user") && (
						<Button
							title="Retry last response"
							secondary
							disabled={
								fork.isPending ||
								toolAction.isPending ||
								preferences.isPending ||
								!!preferences.error
							}
							onPress={() => send.mutate({ kind: "retry" })}
						/>
					)}
			</View>
			<Modal
				visible={!!editing}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setEditing(undefined)}
			>
				<Screen fullScreen>
					<Text style={styles.title}>Edit message</Text>
					<Text style={styles.muted}>
						Replies after this message will be removed and a new response
						generated.
					</Text>
					<Field
						label="Edited message"
						value={editText}
						onChangeText={setEditText}
						multiline
						style={{ minHeight: 160 }}
					/>
					<ErrorNotice error={send.error} />
					<Button
						title="Save and regenerate"
						busy={send.isPending}
						disabled={!editText.trim()}
						onPress={() =>
							send.mutate({
								kind: "edit",
								messageId: editing?.id,
								content: editText,
							})
						}
					/>
					<Button
						title="Cancel"
						secondary
						onPress={() => setEditing(undefined)}
					/>
				</Screen>
			</Modal>
		</KeyboardAvoidingView>
	);
}
