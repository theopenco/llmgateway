import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	Alert,
	FlatList,
	Keyboard,
	KeyboardAvoidingView,
	Modal,
	Share,
	Switch,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chatContext } from "@/api/chat-context";
import {
	completionMessage,
	readChat,
	storedAttachments,
} from "@/api/chat-messages";
import { api, client, queryClient } from "@/api/client";
import { streamCompletion } from "@/api/completion";
import { ChatSettings } from "@/components/ChatSettings";
import { Markdown } from "@/components/Markdown";
import { MessageBubble } from "@/components/MessageBubble";
import { ModelPicker } from "@/components/ModelPicker";
import {
	Button,
	colors,
	ErrorNotice,
	Field,
	Screen,
	styles,
} from "@/components/ui";
import { pickFile } from "@/lib/files";
import { defaultChatSettings, usePreferences } from "@/lib/preferences";

import type { Attachment, ChatMessage } from "@/api/chat-messages";

let localSequence = 0;
function localMessage(
	role: ChatMessage["role"],
	content: string,
	attachments: Attachment[],
	reasoning = "",
): ChatMessage {
	return {
		id: `local-${Date.now()}-${++localSequence}`,
		role,
		content,
		attachments,
		reasoning,
		images: null,
		audios: null,
		documents: null,
		tools: null,
		sources: null,
		metadata: null,
		sequence: 0,
		createdAt: new Date().toISOString(),
	};
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
	const insets = useSafeAreaInsets();
	const [id, setId] = useState(chatId);
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [selectedModel, setSelectedModel] = useState<string>();
	const [selectedWebSearch, setSelectedWebSearch] = useState<boolean>();
	const [temporary, setTemporary] = useState(false);
	const [temporaryMessages, setTemporaryMessages] = useState<ChatMessage[]>([]);
	const [draft, setDraft] = useState("");
	const [reasoning, setReasoning] = useState("");
	const [editing, setEditing] = useState<ChatMessage>();
	const [editText, setEditText] = useState("");
	const controllerRef = useRef<AbortController | null>(null);
	const listRef = useRef<FlatList<ChatMessage>>(null);
	const followRef = useRef(true);
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
	const messages = temporary ? temporaryMessages : (chat.data?.messages ?? []);
	const model = selectedModel ?? chat.data?.chat.model ?? "auto";
	const currentProject = chat.data?.chat.projectId ?? knowledgeProjectId;
	const baseSettings = preferences.data?.chat ?? defaultChatSettings;
	const settings = {
		...baseSettings,
		webSearch:
			selectedWebSearch ?? chat.data?.chat.webSearch ?? baseSettings.webSearch,
	};
	useEffect(() => () => controllerRef.current?.abort(), []);
	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats"] });
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats/{id}"] });
	};
	const send = useMutation({
		mutationFn: async (action: SendAction) => {
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
			followRef.current = true;
			setDraft("");
			setReasoning("");
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
			let response = "";
			let thought = "";
			let generationError: Error | undefined;
			try {
				await streamCompletion({
					projectId,
					model,
					settings,
					messages: [
						...(system ? [{ role: "system" as const, content: system }] : []),
						...contextMessages,
					],
					signal: controller.signal,
					onDelta: (delta) => {
						response += delta.content;
						thought += delta.reasoning;
						setDraft(response);
						setReasoning(thought);
					},
				});
			} catch (error) {
				generationError =
					error instanceof Error
						? error
						: new Error("The response failed. Please try again.");
			}
			const answer =
				response ||
				(thought
					? ""
					: controller.signal.aborted
						? "Response stopped."
						: "The response ended before any content arrived.");
			if (temporary) {
				setTemporaryMessages([
					...prefix,
					localMessage("user", content, files),
					localMessage("assistant", answer, [], thought),
				]);
			} else if (currentId) {
				const lastAssistant =
					action.kind === "retry"
						? previous
								.slice(userIndex + 1)
								.find((message) => message.role === "assistant")
						: undefined;
				await client.POST("/chats/{id}/messages", {
					params: { path: { id: currentId } },
					body: {
						id: lastAssistant?.id,
						role: "assistant",
						...(answer && { content: answer }),
						...(thought && { reasoning: thought }),
						metadata: { model, interrupted: !!generationError },
					},
				});
			}
			setDraft("");
			setReasoning("");
			if (!temporary) {
				await refresh();
			}
			if (generationError && !controller.signal.aborted) {
				throw generationError;
			}
		},
	});
	const attach = useMutation({
		mutationFn: async () => {
			const file = await pickFile([
				"public.image",
				"public.audio",
				"com.adobe.pdf",
				"public.text",
				"public.comma-separated-values-text",
				"org.openxmlformats.wordprocessingml.document",
				"org.openxmlformats.spreadsheetml.sheet",
			]);
			if (file) {
				setAttachments((current) => [
					...current,
					{
						id: `attachment-${++localSequence}`,
						name: file.name,
						mediaType: file.mimeType,
						url: `data:${file.mimeType};base64,${file.base64}`,
					},
				]);
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
	const share = useMutation({
		mutationFn: async () => {
			if (!id) {
				return;
			}
			const result = await client.POST("/chats/{id}/share", {
				params: { path: { id } },
				body: {
					visibility: "public",
					allowDiscovery: false,
					allowForking: false,
				},
			});
			if (result.data) {
				await Share.share({ message: result.data.share.url });
			}
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
							disabled={send.isPending}
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
							disabled={send.isPending}
							busy={fork.isPending}
							onPress={() => fork.mutate()}
						/>
						<Button
							title="Share"
							secondary
							disabled={send.isPending}
							onPress={() =>
								Alert.alert(
									"Share this conversation?",
									"Anyone with the link can read a snapshot of its messages.",
									[
										{ text: "Cancel", style: "cancel" },
										{ text: "Create link", onPress: () => share.mutate() },
									],
								)
							}
						/>
					</View>
				)}
			</View>
			<FlatList
				ref={listRef}
				data={messages}
				keyExtractor={(message) => message.id}
				contentContainerStyle={{ padding: 18, gap: 14 }}
				keyboardShouldPersistTaps="handled"
				onScroll={({ nativeEvent }) => {
					followRef.current =
						nativeEvent.contentSize.height -
							nativeEvent.layoutMeasurement.height -
							nativeEvent.contentOffset.y <
						80;
				}}
				scrollEventThrottle={100}
				onContentSizeChange={() => {
					if (followRef.current) {
						listRef.current?.scrollToEnd({ animated: send.isPending });
					}
				}}
				ListEmptyComponent={
					<Text style={styles.muted}>
						Ask a question. Explore an idea. Make something new.
					</Text>
				}
				renderItem={({ item }) => (
					<MessageBubble
						message={item}
						busy={send.isPending || fork.isPending}
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
					draft || reasoning ? (
						<View style={styles.card}>
							<Text style={styles.eyebrow}>THE LOUNGE</Text>
							{!!reasoning && (
								<Text selectable style={styles.muted}>
									{reasoning}
								</Text>
							)}
							{!!draft && <Markdown>{draft}</Markdown>}
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
						chat.error ??
						update.error ??
						share.error ??
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
					keyboardAppearance="dark"
					multiline
					value={prompt}
					onChangeText={setPrompt}
					style={[styles.input, { maxHeight: 140 }]}
				/>
				<View style={styles.row}>
					<Button
						title="Attach file"
						secondary
						disabled={send.isPending || attachments.length >= 4}
						busy={attach.isPending}
						onPress={() => attach.mutate()}
					/>
					{send.isPending ? (
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
								(!prompt.trim() && !attachments.length) ||
								preferences.isPending ||
								!!preferences.error ||
								fork.isPending ||
								(!!id && (chat.isPending || !!chat.error))
							}
						/>
					)}
				</View>
				{!send.isPending &&
					messages.some((message) => message.role === "user") && (
						<Button
							title="Retry last response"
							secondary
							disabled={
								fork.isPending || preferences.isPending || !!preferences.error
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
