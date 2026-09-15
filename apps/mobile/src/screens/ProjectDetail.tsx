import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { api, client, queryClient } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";
import { pickFile } from "@/lib/files";

export function ProjectDetail({
	id,
	billingProjectId,
	onChat,
	onNewChat,
}: {
	id: string;
	billingProjectId: string;
	onChat: (chatId: string) => void;
	onNewChat: () => void;
}) {
	const params = { path: { id } };
	const detail = api.useQuery("get", "/chat-projects/{id}", { params });
	const memories = api.useQuery("get", "/chat-projects/{id}/memories", {
		params,
	});
	const chats = api.useQuery("get", "/chats", {
		params: { query: { projectId: id } },
	});
	const [memory, setMemory] = useState("");
	const [memoryId, setMemoryId] = useState<string>();
	const refreshFiles = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["get", "/chat-projects/{id}"],
		});
		await queryClient.invalidateQueries({
			queryKey: ["get", "/chat-projects"],
		});
	};
	const refreshMemories = () =>
		queryClient.invalidateQueries({
			queryKey: ["get", "/chat-projects/{id}/memories"],
		});
	const upload = useMutation({
		mutationFn: async () => {
			const file = await pickFile();
			if (!file) {
				return;
			}
			const token = await ensureGatewayKey(billingProjectId);
			await client.POST("/chat-projects/{id}/files", {
				params,
				body: {
					name: file.name,
					mimeType: file.mimeType,
					contentBase64: file.base64,
				},
				headers: { "x-llmgateway-key": token },
			});
			await refreshFiles();
		},
	});
	const deleteFile = api.useMutation(
		"delete",
		"/chat-projects/{id}/files/{fileId}",
		{ onSuccess: refreshFiles },
	);
	const saveMemory = useMutation({
		mutationFn: async () => {
			if (memoryId) {
				await client.PATCH("/chat-projects/{id}/memories/{memoryId}", {
					params: { path: { id, memoryId } },
					body: { content: memory.trim() },
				});
			} else {
				await client.POST("/chat-projects/{id}/memories", {
					params,
					body: { content: memory.trim() },
				});
			}
			setMemory("");
			setMemoryId(undefined);
			await refreshMemories();
		},
	});
	const deleteMemory = api.useMutation(
		"delete",
		"/chat-projects/{id}/memories/{memoryId}",
		{ onSuccess: refreshMemories },
	);
	return (
		<Screen>
			<Text style={styles.title}>{detail.data?.project.name ?? "Project"}</Text>
			{detail.isPending && <Loading />}
			<ErrorNotice
				error={
					detail.error ??
					memories.error ??
					chats.error ??
					upload.error ??
					deleteFile.error ??
					saveMemory.error ??
					deleteMemory.error
				}
			/>
			<Text style={styles.muted}>{detail.data?.project.description}</Text>
			{!!detail.data?.project.instructions && (
				<Text style={styles.body}>{detail.data.project.instructions}</Text>
			)}
			<Button title="Start project conversation" onPress={onNewChat} />
			<Text style={styles.heading}>Knowledge files</Text>
			<Text style={styles.muted}>
				Add PDF, spreadsheet, or text files up to 10 MB.
			</Text>
			<Button
				title="Add knowledge file"
				busy={upload.isPending}
				onPress={() => upload.mutate()}
			/>
			{detail.data?.files.map((file) => (
				<View key={file.id} style={styles.card}>
					<Text style={styles.body}>{file.name}</Text>
					<Text style={styles.muted}>
						{file.status} · {file.chunkCount} excerpts
					</Text>
					{!!file.error && <Text style={styles.error}>{file.error}</Text>}
					<Button
						title={`Remove ${file.name}`}
						secondary
						onPress={() =>
							Alert.alert("Remove knowledge file?", file.name, [
								{ text: "Cancel", style: "cancel" },
								{
									text: "Remove",
									style: "destructive",
									onPress: () =>
										deleteFile.mutate({
											params: { path: { id, fileId: file.id } },
										}),
								},
							])
						}
					/>
				</View>
			))}
			<Text style={styles.heading}>Project memory</Text>
			<Field
				label="Memory"
				value={memory}
				onChangeText={setMemory}
				multiline
				maxLength={1000}
			/>
			<Button
				title={memoryId ? "Update memory" : "Add memory"}
				disabled={!memory.trim()}
				busy={saveMemory.isPending}
				onPress={() => saveMemory.mutate()}
			/>
			{memoryId && (
				<Button
					title="Cancel editing memory"
					secondary
					onPress={() => {
						setMemoryId(undefined);
						setMemory("");
					}}
				/>
			)}
			{memories.data?.memories.map((item) => (
				<View key={item.id} style={styles.card}>
					<Text style={styles.body}>{item.content}</Text>
					<Button
						title="Edit memory"
						secondary
						onPress={() => {
							setMemoryId(item.id);
							setMemory(item.content);
						}}
					/>
					<Button
						title="Delete memory"
						secondary
						onPress={() =>
							Alert.alert("Delete memory?", item.content, [
								{ text: "Cancel", style: "cancel" },
								{
									text: "Delete",
									style: "destructive",
									onPress: () =>
										deleteMemory.mutate({
											params: { path: { id, memoryId: item.id } },
										}),
								},
							])
						}
					/>
				</View>
			))}
			<Text style={styles.heading}>Project conversations</Text>
			{chats.data?.chats.map((chat) => (
				<Button
					key={chat.id}
					title={chat.title}
					secondary
					onPress={() => onChat(chat.id)}
				/>
			))}
		</Screen>
	);
}
