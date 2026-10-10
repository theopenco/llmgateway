import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	FlatList,
	Keyboard,
	KeyboardAvoidingView,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { refreshChatHistory } from "@/api/chat-history";
import { client, queryClient } from "@/api/client";
import {
	completeComparisonPanel,
	createComparison,
	loadComparison,
} from "@/api/comparison";
import { continueComparison } from "@/api/comparison-tools";
import { saveReply } from "@/api/reply";
import { pendingTool } from "@/api/tool-parts";
import { ChatSettings } from "@/components/ChatSettings";
import { Markdown } from "@/components/Markdown";
import { MessageBubble } from "@/components/MessageBubble";
import { ModelPicker } from "@/components/ModelPicker";
import { Sources } from "@/components/Sources";
import { ToolCalls } from "@/components/ToolCalls";
import { Button, ErrorNotice, Field, Loading, styles } from "@/components/ui";
import { pickChatAttachment } from "@/lib/chat-files";
import { defaultChatSettings, usePreferences } from "@/lib/preferences";
import { useFollowingList } from "@/lib/use-following-list";

import type { Attachment, ChatMessage } from "@/api/chat-messages";
import type { ComparisonPanel } from "@/api/comparison";
import type { ComparisonToolAnswer } from "@/api/comparison-tools";
import type { Reply } from "@/api/reply";

export function Comparison({
	chatId,
	organizationId,
	projectId,
	onOpenChat,
}: {
	chatId?: string;
	organizationId: string;
	projectId: string;
	onOpenChat: (id: string) => void;
}) {
	const insets = useSafeAreaInsets();
	const preferences = usePreferences();
	const [id, setId] = useState(chatId);
	const [models, setModels] = useState(["auto", "auto"]);
	const [configuring, setConfiguring] = useState(!chatId);
	const [created, setCreated] = useState<ComparisonPanel[]>();
	const [active, setActive] = useState(0);
	const [prompt, setPrompt] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [drafts, setDrafts] = useState<Record<string, Reply>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [unsaved, setUnsaved] = useState<string[]>([]);
	const [toolMessages, setToolMessages] = useState<Record<string, ChatMessage>>(
		{},
	);
	const [continuingId, setContinuingId] = useState<string>();
	const abortRef = useRef<AbortController | null>(null);
	const following = useFollowingList<ChatMessage>(!configuring);
	useEffect(() => () => abortRef.current?.abort(), []);
	const snapshot = useQuery({
		queryKey: ["comparison-session", id],
		queryFn: () => loadComparison(id!),
		enabled: !!id,
		refetchOnMount: "always",
	});
	const panels =
		created ??
		snapshot.data?.map((item) => ({
			id: item.chat.id,
			model: item.chat.model,
		})) ??
		[];
	const panel = panels[active];
	const history = snapshot.data?.find((item) => item.chat.id === panel?.id);
	const draft = panel ? drafts[panel.id] : undefined;
	const messages =
		history?.messages.map((message) => toolMessages[message.id] ?? message) ??
		[];
	const primaryMessages =
		snapshot.data?.[0]?.messages.map(
			(message) => toolMessages[message.id] ?? message,
		) ?? [];
	const primaryPending = primaryMessages.some((message) =>
		message.toolParts?.some(pendingTool),
	);
	const primarySelected = panel?.id === panels[0]?.id;
	const settings = preferences.data?.chat ?? defaultChatSettings;
	const refresh = async (rootId = id) => {
		await queryClient.invalidateQueries({
			queryKey: ["comparison-session", rootId],
		});
		await queryClient.invalidateQueries({ queryKey: ["get", "/chats/{id}"] });
		await refreshChatHistory();
	};
	const send = useMutation({
		mutationFn: async (retry: boolean) => {
			if (primaryPending && (!retry || primarySelected)) {
				throw new Error("Review the requests in Model 1 before continuing.");
			}
			toolAction.reset();
			Keyboard.dismiss();
			const controller = new AbortController();
			abortRef.current = controller;
			following.startFollowing();
			let current = panels;
			if (configuring) {
				current = await createComparison({
					models,
					panels: created ?? [],
					organizationId,
					title: prompt.trim() || attachments[0]?.name || "Model comparison",
					onCreated: (items) => {
						setId(items[0].id);
						setCreated(items);
					},
				});
				setConfiguring(false);
			}
			if (controller.signal.aborted) {
				await refresh(current[0]?.id);
				return;
			}
			const targets = retry
				? current.filter((item) => item.id === panel?.id)
				: current;
			const responses: Record<string, Reply> = {};
			const persisted = new Set<string>();
			const failures: Record<string, string> = {};
			setErrors({});
			setDrafts({});
			const results = await Promise.allSettled(
				targets.map(async (target) => {
					await completeComparisonPanel({
						panel: target,
						primary: target.id === current[0].id,
						projectId,
						prompt,
						attachments,
						settings,
						signal: controller.signal,
						retry,
						onReply: (reply) => {
							responses[target.id] = reply;
							setDrafts((value) => ({ ...value, [target.id]: reply }));
						},
						onSaved: () => {
							persisted.add(target.id);
						},
					});
				}),
			);
			results.forEach((result, index) => {
				if (result.status === "rejected") {
					failures[targets[index].id] =
						result.reason instanceof Error
							? result.reason.message
							: "This model could not respond.";
				}
			});
			setErrors(failures);
			const pendingSaves = Object.keys(responses).filter(
				(key) => !persisted.has(key),
			);
			setUnsaved(pendingSaves);
			await refresh(current[0]?.id);
			setToolMessages({});
			setCreated(undefined);
			setDrafts(
				Object.fromEntries(pendingSaves.map((key) => [key, responses[key]])),
			);
			if (!retry && persisted.size) {
				setPrompt("");
				setAttachments([]);
			}
		},
	});
	const toolAction = useMutation({
		mutationFn: async (answer?: ComparisonToolAnswer) => {
			const rootId = panels[0]?.id;
			if (!rootId) {
				throw new Error("Reload this comparison before continuing.");
			}
			const controller = new AbortController();
			abortRef.current = controller;
			let pendingReply: Reply | undefined;
			following.startFollowing();
			try {
				await continueComparison({
					chatId: rootId,
					projectId,
					settings,
					answer,
					signal: controller.signal,
					onStored: (message) => {
						pendingReply = undefined;
						setToolMessages((current) => ({
							...current,
							[message.id]: message,
						}));
					},
					onReply: (reply, messageId) => {
						pendingReply = reply;
						setContinuingId(messageId);
						setDrafts((current) => ({ ...current, [rootId]: reply }));
					},
				});
			} finally {
				if (pendingReply) {
					setUnsaved((current) => [...new Set([...current, rootId])]);
				} else {
					setContinuingId(undefined);
					setDrafts((current) =>
						Object.fromEntries(
							Object.entries(current).filter(([key]) => key !== rootId),
						),
					);
				}
				await refresh(rootId);
			}
		},
	});
	const attach = useMutation({
		mutationFn: async () => {
			const file = await pickChatAttachment();
			if (file) {
				setAttachments((items) => [...items, file]);
			}
		},
	});
	const changeModel = useMutation({
		mutationFn: async (model: string) => {
			if (!panel) {
				return;
			}
			await client.PATCH("/chats/{id}", {
				params: { path: { id: panel.id } },
				body: { model },
			});
			await refresh();
			setCreated(undefined);
		},
	});
	const save = useMutation({
		mutationFn: async () => {
			if (!panel || !draft) {
				return;
			}
			const latest = await client.GET("/chats/{id}", {
				params: { path: { id: panel.id } },
			});
			if (!latest.data) {
				throw new Error("Could not load this conversation.");
			}
			const messages = latest.data.messages;
			const lastUser = messages
				.map((message) => message.role)
				.lastIndexOf("user");
			const previous = messages
				.slice(lastUser + 1)
				.find((message) => message.role === "assistant");
			await saveReply(
				panel.id,
				draft,
				primarySelected ? (continuingId ?? previous?.id) : previous?.id,
			);
			await refresh();
			setToolMessages({});
			setContinuingId(undefined);
			setUnsaved((items) => items.filter((key) => key !== panel.id));
			setDrafts((items) =>
				Object.fromEntries(
					Object.entries(items).filter(([key]) => key !== panel.id),
				),
			);
			setErrors((items) =>
				Object.fromEntries(
					Object.entries(items).filter(([key]) => key !== panel.id),
				),
			);
		},
	});
	const busy =
		send.isPending ||
		save.isPending ||
		changeModel.isPending ||
		toolAction.isPending;
	const archived = snapshot.data?.[0]?.chat.status === "archived";
	return (
		<KeyboardAvoidingView
			style={styles.screen}
			behavior="padding"
			keyboardVerticalOffset={insets.top + 44}
		>
			<View style={{ padding: 18, gap: 10 }}>
				<Text style={styles.heading} numberOfLines={1}>
					{snapshot.data?.[0]?.chat.title ?? "Compare models"}
				</Text>
				{!configuring && (
					<>
						<ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
							{panels.map((item, index) => (
								<Button
									key={item.id}
									title={`Model ${index + 1}`}
									secondary={index !== active}
									onPress={() => setActive(index)}
								/>
							))}
						</ScrollView>
						{panel && (
							<ModelPicker
								value={panel.model}
								disabled={
									busy ||
									unsaved.length > 0 ||
									(primarySelected && primaryPending)
								}
								onChange={(model) => changeModel.mutate(model)}
							/>
						)}
					</>
				)}
				<ChatSettings />
			</View>
			<FlatList
				{...following.listProps}
				data={messages.filter(
					(message) => !(draft && message.id === continuingId),
				)}
				keyExtractor={(message) => message.id}
				contentContainerStyle={{ padding: 18, gap: 14 }}
				keyboardShouldPersistTaps="handled"
				ListHeaderComponent={
					configuring ? (
						<View style={{ gap: 12 }}>
							<Text style={styles.muted}>
								Send the same message to up to three models. Each model keeps
								its own conversation. Connected apps are available to Model 1,
								with your approval.
							</Text>
							{models.map((model, index) => (
								<ModelPicker
									key={index}
									label={`Model ${index + 1}`}
									value={model}
									disabled={busy || !!created?.length}
									onChange={(value) =>
										setModels((items) =>
											items.map((item, at) => (at === index ? value : item)),
										)
									}
								/>
							))}
							{models.length < 3 && (
								<Button
									title="Add a third model"
									secondary
									disabled={busy || !!created?.length}
									onPress={() => setModels([...models, "auto"])}
								/>
							)}
						</View>
					) : undefined
				}
				renderItem={({ item }) => (
					<MessageBubble
						message={item}
						busy={
							busy ||
							archived ||
							unsaved.length > 0 ||
							preferences.isPending ||
							preferences.isError
						}
						onToolAnswer={
							primarySelected
								? (toolCallId, approved) =>
										toolAction.mutate({
											messageId: item.id,
											toolCallId,
											approved,
										})
								: undefined
						}
					/>
				)}
				ListFooterComponent={
					draft ? (
						<View style={styles.card}>
							<Text style={styles.eyebrow}>{draft.model}</Text>
							{!!draft.reasoning && (
								<Text selectable style={styles.muted}>
									{draft.reasoning}
								</Text>
							)}
							{!!draft.content && <Markdown>{draft.content}</Markdown>}
							<ToolCalls parts={draft.tools ?? []} busy />
							<Sources sources={draft.sources} />
						</View>
					) : !configuring && snapshot.isPending ? (
						<Loading />
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
						snapshot.error ??
						attach.error ??
						changeModel.error ??
						save.error ??
						preferences.error ??
						(panel && errors[panel.id] ? new Error(errors[panel.id]) : null)
					}
				/>
				{Object.keys(errors).length > 0 && (
					<Text style={styles.muted}>
						Some models need attention. Select a model to review its result.
					</Text>
				)}
				{archived && (
					<Text style={styles.muted}>
						Restore this comparison in history to continue.
					</Text>
				)}
				{primaryPending && (
					<Text style={styles.muted}>
						Review the requests in Model 1 before sending another message.
					</Text>
				)}
				{primarySelected &&
					!primaryPending &&
					primaryMessages.at(-1)?.metadata?.toolContinuation === true && (
						<Button
							title="Continue response"
							secondary
							disabled={
								busy ||
								archived ||
								unsaved.length > 0 ||
								preferences.isPending ||
								preferences.isError
							}
							onPress={() => toolAction.mutate(undefined)}
						/>
					)}
				{attachments.map((item) => (
					<View key={item.id} style={styles.row}>
						<Text style={[styles.muted, { flex: 1 }]} numberOfLines={1}>
							{item.name}
						</Text>
						<Button
							title={`Remove ${item.name}`}
							secondary
							disabled={busy}
							onPress={() =>
								setAttachments((items) =>
									items.filter((file) => file.id !== item.id),
								)
							}
						/>
					</View>
				))}
				<Field
					label="Message to all models"
					multiline
					value={prompt}
					onChangeText={setPrompt}
					editable={!busy && !archived}
				/>
				{send.isPending || toolAction.isPending ? (
					<Button
						title={toolAction.isPending ? "Stop response" : "Stop all models"}
						onPress={() => abortRef.current?.abort()}
					/>
				) : (
					<>
						<Button
							title={
								configuring && created?.length
									? "Retry comparison setup"
									: "Send to all models"
							}
							disabled={
								busy ||
								primaryPending ||
								archived ||
								unsaved.length > 0 ||
								preferences.isPending ||
								preferences.isError ||
								(!configuring && !panels.length) ||
								(!prompt.trim() && !attachments.length)
							}
							onPress={() => send.mutate(false)}
						/>
						<View style={[styles.row, { flexWrap: "wrap" }]}>
							<Button
								title="Attach a file"
								secondary
								busy={attach.isPending}
								disabled={busy || archived}
								onPress={() => attach.mutate()}
							/>
							{panel && unsaved.includes(panel.id) ? (
								<Button
									title="Retry saving response"
									busy={save.isPending}
									onPress={() => save.mutate()}
								/>
							) : (
								panel && (
									<Button
										title="Retry this model"
										secondary
										disabled={
											busy ||
											(primarySelected && primaryPending) ||
											archived ||
											unsaved.length > 0 ||
											!history?.messages.some(
												(message) => message.role === "user",
											)
										}
										onPress={() => send.mutate(true)}
									/>
								)
							)}
							{panel && (
								<Button
									title="Open this conversation"
									secondary
									disabled={busy || unsaved.length > 0}
									onPress={() => onOpenChat(panel.id)}
								/>
							)}
						</View>
					</>
				)}
			</View>
		</KeyboardAvoidingView>
	);
}
