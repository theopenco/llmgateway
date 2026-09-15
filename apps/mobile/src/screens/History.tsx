import { useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { api, queryClient } from "@/api/client";
import { Button, ErrorNotice, Field, Loading, styles } from "@/components/ui";

export function History({
	organizationId,
	onChat,
}: {
	organizationId: string;
	onChat: (id: string) => void;
}) {
	const [search, setSearch] = useState("");
	const [archived, setArchived] = useState(false);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/chats"] });
	const update = api.useMutation("patch", "/chats/{id}", {
		onSuccess: refresh,
	});
	const remove = api.useMutation("delete", "/chats/{id}", {
		onSuccess: refresh,
	});
	const chats = api.useQuery("get", "/chats", {
		params: {
			query: { organizationId, status: archived ? "archived" : "active" },
		},
	});
	return (
		<View style={styles.screen}>
			<View style={{ padding: 22, gap: 14 }}>
				<Text style={styles.title}>Conversations</Text>
				<Field
					label="Search conversations"
					value={search}
					onChangeText={setSearch}
				/>
				<Button
					title={
						archived
							? "Show active conversations"
							: "Show archived conversations"
					}
					secondary
					onPress={() => setArchived(!archived)}
				/>
				<ErrorNotice error={chats.error ?? update.error ?? remove.error} />
			</View>
			{chats.isPending ? (
				<Loading />
			) : (
				<FlatList
					data={
						chats.data?.chats.filter(
							(chat) =>
								chat.status === (archived ? "archived" : "active") &&
								chat.title.toLowerCase().includes(search.toLowerCase()),
						) ?? []
					}
					keyExtractor={(chat) => chat.id}
					contentContainerStyle={{ padding: 22, gap: 12 }}
					refreshing={chats.isRefetching}
					onRefresh={() => void chats.refetch()}
					ListEmptyComponent={
						<Text style={styles.muted}>
							Your conversations will appear here.
						</Text>
					}
					renderItem={({ item }) => (
						<View style={styles.card}>
							<Pressable
								role="button"
								aria-label={item.title}
								onPress={() => onChat(item.id)}
								style={{ minHeight: 48 }}
							>
								<Text style={styles.heading}>
									{item.pinned ? "★ " : ""}
									{item.title}
								</Text>
								<Text style={styles.muted}>
									{item.model} · {item.messageCount} messages
								</Text>
							</Pressable>
							<View style={styles.row}>
								<Button
									title={archived ? "Restore" : "Archive"}
									secondary
									busy={
										update.isPending &&
										update.variables?.params.path.id === item.id
									}
									onPress={() =>
										update.mutate({
											params: { path: { id: item.id } },
											body: { status: archived ? "active" : "archived" },
										})
									}
								/>
								<Button
									title="Delete"
									secondary
									busy={
										remove.isPending &&
										remove.variables?.params.path.id === item.id
									}
									onPress={() =>
										Alert.alert(
											"Delete this conversation?",
											"This cannot be undone.",
											[
												{ text: "Cancel", style: "cancel" },
												{
													text: "Delete",
													style: "destructive",
													onPress: () =>
														remove.mutate({
															params: { path: { id: item.id } },
														}),
												},
											],
										)
									}
								/>
							</View>
						</View>
					)}
				/>
			)}
		</View>
	);
}
