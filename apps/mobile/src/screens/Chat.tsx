import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	Alert,
	FlatList,
	KeyboardAvoidingView,
	Share,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { chatContext } from "@/api/chat-context";
import { api, client, queryClient } from "@/api/client";
import { streamCompletion } from "@/api/completion";
import { ModelPicker } from "@/components/ModelPicker";
import { Button, colors, ErrorNotice, styles } from "@/components/ui";

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
	const [selectedModel, setSelectedModel] = useState<string>();
	const [draft, setDraft] = useState("");
	const [reasoning, setReasoning] = useState("");
	const controllerRef = useRef<AbortController | null>(null);
	const chat = api.useQuery(
		"get",
		"/chats/{id}",
		{ params: { path: { id: id ?? "" } } },
		{ enabled: !!id },
	);
	const model = selectedModel ?? chat.data?.chat.model ?? "auto";
	const currentProject = chat.data?.chat.projectId ?? knowledgeProjectId;
	useEffect(() => () => controllerRef.current?.abort(), []);
	const refresh = async () => {
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats"] });
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats/{id}"] });
	};
	const send = useMutation({
		mutationFn: async (retry: boolean) => {
			const previous = chat.data?.messages ?? [];
			const lastUserIndex = previous
				.map((message) => message.role)
				.lastIndexOf("user");
			const content = retry
				? (previous[lastUserIndex]?.content ?? "")
				: prompt.trim();
			if (!content) {
				return;
			}
			controllerRef.current = new AbortController();
			setDraft("");
			setReasoning("");
			const system = await chatContext(content, projectId, currentProject);
			let currentId = id;
			if (!currentId) {
				const result = await client.POST("/chats", {
					body: {
						title: content.slice(0, 200),
						model,
						organizationId,
						projectId: currentProject,
					},
				});
				if (!result.data) {
					throw new Error("Could not create the conversation.");
				}
				currentId = result.data.chat.id;
				setId(currentId);
			}
			if (!retry) {
				await client.POST("/chats/{id}/messages", {
					params: { path: { id: currentId } },
					body: { role: "user", content },
				});
			}
			setPrompt("");
			await refresh();
			let response = "";
			let thought = "";
			const lastAssistant = retry
				? previous
						.slice(lastUserIndex + 1)
						.find((message) => message.role === "assistant")
				: undefined;
			let generationError: Error | undefined;
			try {
				await streamCompletion({
					projectId,
					model,
					messages: [
						...(system ? [{ role: "system" as const, content: system }] : []),
						...(retry ? previous.slice(0, lastUserIndex) : previous).map(
							(message) => ({
								role: message.role,
								content: message.content ?? "",
							}),
						),
						{ role: "user", content },
					],
					signal: controllerRef.current.signal,
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
			await client.POST("/chats/{id}/messages", {
				params: { path: { id: currentId } },
				body: {
					id: lastAssistant?.id,
					role: "assistant",
					content:
						response ||
						thought ||
						"The response ended before any content arrived.",
					reasoning: thought,
					metadata: { model, interrupted: !!generationError },
				},
			});
			setDraft("");
			setReasoning("");
			await refresh();
			if (generationError) {
				throw generationError;
			}
		},
	});
	const update = api.useMutation("patch", "/chats/{id}", {
		onSuccess: refresh,
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
					{chat.data?.chat.title ?? "A fresh conversation"}
				</Text>
				<ModelPicker value={model} onChange={setSelectedModel} />
				{!!id && (
					<View style={styles.row}>
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
						<Button
							title="Share"
							secondary
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
				data={chat.data?.messages ?? []}
				keyExtractor={(message) => message.id}
				contentContainerStyle={{ padding: 18, gap: 14 }}
				ListEmptyComponent={
					<Text style={styles.muted}>
						Ask a question. Explore an idea. Make something new.
					</Text>
				}
				renderItem={({ item }) => (
					<View style={styles.card}>
						<Text style={styles.eyebrow}>
							{item.role === "user" ? "YOU" : "THE LOUNGE"}
						</Text>
						{!!item.reasoning && (
							<Text selectable style={styles.muted}>
								{item.reasoning}
							</Text>
						)}
						<Text selectable style={styles.body}>
							{item.content}
						</Text>
					</View>
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
							<Text selectable style={styles.body}>
								{draft}
							</Text>
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
					error={send.error ?? chat.error ?? update.error ?? share.error}
				/>
				<TextInput
					aria-label="Message"
					placeholder="Ask anything…"
					placeholderTextColor={colors.muted}
					multiline
					value={prompt}
					onChangeText={setPrompt}
					style={[styles.input, { maxHeight: 140 }]}
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
						onPress={() => send.mutate(false)}
						disabled={!prompt.trim() || !model.trim()}
					/>
				)}
				{!!id &&
					!send.isPending &&
					chat.data?.messages.some((message) => message.role === "user") && (
						<Button
							title="Retry last response"
							secondary
							onPress={() => send.mutate(true)}
						/>
					)}
			</View>
		</KeyboardAvoidingView>
	);
}
