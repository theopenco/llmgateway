import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, FlatList, Pressable, Text, View } from "react-native";

import { refreshChatHistory } from "@/api/chat-history";
import { api, client } from "@/api/client";
import {
	Button,
	colors,
	ErrorNotice,
	Field,
	IconButton,
	Loading,
	styles,
} from "@/components/ui";

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
					quiet
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
					contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 24 }}
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
						<View
							style={[
								styles.row,
								{
									paddingVertical: 15,
									borderBottomWidth: 0.5,
									borderBottomColor: colors.subtle,
								},
							]}
						>
							<Pressable
								role="button"
								aria-label={`${item.title}, ${item.model}, ${item.messageCount} messages`}
								onPress={() => onChat(item.id)}
								style={{ minHeight: 48, flex: 1, gap: 4 }}
							>
								<Text
									numberOfLines={2}
									style={[styles.body, { fontWeight: "600" }]}
								>
									{item.pinned ? "★ " : ""}
									{item.title}
								</Text>
								<Text numberOfLines={1} style={styles.muted}>
									{item.model} · {item.messageCount} messages
								</Text>
							</Pressable>
							<View style={{ flexDirection: "row" }}>
								<IconButton
									name="folder"
									accessibilityLabel={archived ? "Restore" : "Archive"}
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
								<IconButton
									name="close"
									accessibilityLabel="Delete"
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
