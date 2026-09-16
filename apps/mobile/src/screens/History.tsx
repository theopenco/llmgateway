import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { refreshChatHistory } from "@/api/chat-history";
import { api, client } from "@/api/client";
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
	const [query, setQuery] = useState("");
	useEffect(() => {
		const timeout = setTimeout(() => setQuery(search.trim()), 300);
		return () => clearTimeout(timeout);
	}, [search]);
	const update = api.useMutation("patch", "/chats/{id}", {
		onSuccess: refreshChatHistory,
	});
	const remove = api.useMutation("delete", "/chats/{id}", {
		onSuccess: refreshChatHistory,
	});
	const filters = {
		organizationId,
		status: archived ? ("archived" as const) : ("active" as const),
		q: query,
	};
	const chats = useInfiniteQuery({
		queryKey: ["get", "/chats/search", filters],
		initialPageParam: 0,
		refetchOnMount: "always",
		queryFn: async ({ pageParam, signal }) => {
			const { data } = await client.GET("/chats/search", {
				params: { query: { ...filters, limit: 50, offset: pageParam } },
				signal,
			});
			if (!data) {
				throw new Error("Could not load conversations.");
			}
			return data;
		},
		getNextPageParam: (last, pages) => {
			const loaded = pages.reduce(
				(count, page) => count + page.chats.length,
				0,
			);
			return last.chats.length && loaded < last.total ? loaded : undefined;
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
				<Text style={styles.muted}>Search titles and message text.</Text>
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
					data={chats.data?.pages.flatMap((page) => page.chats) ?? []}
					keyExtractor={(chat) => chat.id}
					contentContainerStyle={{ padding: 22, gap: 12 }}
					refreshing={chats.isRefetching}
					onRefresh={() => void chats.refetch()}
					ListEmptyComponent={
						<Text style={styles.muted}>
							{query
								? "No matching conversations."
								: "Your conversations will appear here."}
						</Text>
					}
					ListFooterComponent={
						chats.hasNextPage ? (
							<Button
								title="Load more conversations"
								secondary
								busy={chats.isFetchingNextPage}
								onPress={() => void chats.fetchNextPage()}
							/>
						) : undefined
					}
					renderItem={({ item }) => (
						<View style={styles.card}>
							<Pressable
								role="button"
								aria-label={`${item.title}, ${item.model}, ${item.messageCount} messages`}
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
													text: "Delete conversation",
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
