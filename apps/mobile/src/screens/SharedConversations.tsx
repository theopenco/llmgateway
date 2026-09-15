import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Modal, Text, View } from "react-native";

import { readChatMessage } from "@/api/chat-messages";
import { api, client, queryClient } from "@/api/client";
import { MessageBubble } from "@/components/MessageBubble";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";
import { config } from "@/config";

interface SharedLink {
	id: string;
	organization: boolean;
}

export function parseSharedLink(value: string): SharedLink {
	const url = new URL(value.trim());
	if (url.origin !== new URL(config.webUrl).origin) {
		throw new Error("Paste a Lounge conversation link.");
	}
	const publicMatch = url.pathname.match(/^\/share\/([^/]+)\/?$/);
	const orgMatch = url.pathname.match(/^\/org\/[^/]+\/chat\/([^/]+)\/?$/);
	const id = publicMatch?.[1] ?? orgMatch?.[1];
	if (!id) {
		throw new Error("This link does not point to a shared conversation.");
	}
	return { id, organization: !!orgMatch };
}

function Snapshot({
	link,
	onClose,
	onChat,
}: {
	link: SharedLink;
	onClose: () => void;
	onChat: (id: string) => void;
}) {
	const snapshot = useQuery({
		queryKey: ["native-share", link],
		refetchOnMount: "always",
		queryFn: async () => {
			const result = link.organization
				? await client.GET("/chats/org-share/{shareId}", {
						params: { path: { shareId: link.id } },
					})
				: await client.GET("/public/chats/share/{shareId}", {
						params: { path: { shareId: link.id } },
					});
			if (!result.data) {
				throw new Error("This shared conversation is unavailable.");
			}
			return {
				...result.data.share,
				messages: result.data.share.messages.map((message) =>
					readChatMessage({
						...message,
						audios: message.audios ?? null,
						sources: message.sources ?? null,
						metadata: message.metadata ?? null,
					}),
				),
			};
		},
	});
	const visibleSnapshot = snapshot.isError ? undefined : snapshot.data;
	const fork = useMutation({
		mutationFn: async () => {
			const result = await client.POST("/chats/share/{shareId}/fork", {
				params: { path: { shareId: link.id } },
			});
			if (!result.data) {
				throw new Error("Could not fork this conversation.");
			}
			await queryClient.invalidateQueries({ queryKey: ["get", "/chats"] });
			return result.data.chat.id;
		},
		onSuccess: (id) => {
			onClose();
			onChat(id);
		},
	});
	return (
		<Screen fullScreen>
			<Text style={styles.title}>
				{visibleSnapshot?.title ?? "Shared conversation"}
			</Text>
			<Text style={styles.muted}>A snapshot shared by its owner.</Text>
			<Button
				title="Done"
				secondary
				onPress={onClose}
				disabled={fork.isPending}
			/>
			{snapshot.isPending && <Loading />}
			<ErrorNotice error={snapshot.error ?? fork.error} />
			{snapshot.isError && (
				<Button title="Try again" onPress={() => void snapshot.refetch()} />
			)}
			{visibleSnapshot?.allowForking && (
				<Button
					title="Fork into my conversations"
					busy={fork.isPending}
					onPress={() => fork.mutate()}
				/>
			)}
			{visibleSnapshot?.messages.map((message) => (
				<MessageBubble key={message.id} message={message} />
			))}
		</Screen>
	);
}

export function SharedConversations({
	organizationId,
	onChat,
}: {
	organizationId: string;
	onChat: (id: string) => void;
}) {
	const [link, setLink] = useState("");
	const [selected, setSelected] = useState<SharedLink>();
	const [error, setError] = useState<unknown>();
	const shares = api.useQuery("get", "/chats/org/{organizationId}/shares", {
		params: { path: { organizationId } },
	});
	return (
		<View style={styles.screen}>
			<View style={{ padding: 22, gap: 14 }}>
				<Text style={styles.title}>Shared conversations</Text>
				<Field
					label="Shared conversation link"
					value={link}
					onChangeText={setLink}
					autoCapitalize="none"
					keyboardType="url"
				/>
				<Button
					title="Open shared conversation"
					disabled={!link.trim()}
					onPress={() => {
						try {
							setSelected(parseSharedLink(link));
							setError(undefined);
						} catch (cause) {
							setError(cause);
						}
					}}
				/>
				<ErrorNotice error={error ?? shares.error} />
				<Text style={styles.heading}>From your workspace</Text>
			</View>
			{shares.isPending && <Loading />}
			<FlatList
				data={shares.data?.shares ?? []}
				keyExtractor={(item) => item.id}
				refreshing={shares.isRefetching}
				onRefresh={() => void shares.refetch()}
				contentContainerStyle={{ padding: 22, gap: 12 }}
				ListEmptyComponent={
					!shares.isPending ? (
						<Text style={styles.muted}>
							No conversations have been shared with this workspace yet.
						</Text>
					) : undefined
				}
				renderItem={({ item }) => (
					<Button
						title={item.title}
						secondary
						onPress={() => setSelected({ id: item.id, organization: true })}
					/>
				)}
			/>
			<Modal
				visible={!!selected}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setSelected(undefined)}
			>
				{selected && (
					<Snapshot
						link={selected}
						onClose={() => setSelected(undefined)}
						onChat={onChat}
					/>
				)}
			</Modal>
		</View>
	);
}
