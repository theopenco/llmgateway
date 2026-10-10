import { useInfiniteQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { client } from "@/api/client";
import { parseEscapeLink } from "@/api/escape";
import { Button, ErrorNotice, Field, Loading, styles } from "@/components/ui";

import { getLevel } from "@llmgateway/shared/sandbox-escape";

export function EscapeRuns({
	organizationId,
	onReplay,
}: {
	organizationId: string;
	onReplay: (id: string) => void;
}) {
	const [link, setLink] = useState("");
	const [error, setError] = useState<Error | null>(null);
	const runs = useInfiniteQuery({
		queryKey: ["escape-runs", organizationId],
		initialPageParam: 0,
		refetchOnMount: "always",
		queryFn: async ({ pageParam, signal }) => {
			const { data } = await client.GET("/escape/runs", {
				params: { query: { organizationId, limit: 25, offset: pageParam } },
				signal,
			});
			if (!data) {
				throw new Error("Could not load saved runs.");
			}
			return data;
		},
		getNextPageParam: (last, pages) =>
			last.hasMore
				? pages.reduce((total, page) => total + page.runs.length, 0)
				: undefined,
	});
	return (
		<SafeAreaView style={styles.screen} edges={["bottom"]}>
			<FlatList
				data={runs.data?.pages.flatMap((page) => page.runs) ?? []}
				keyExtractor={(run) => run.id}
				contentContainerStyle={styles.content}
				refreshing={runs.isRefetching}
				onRefresh={() => void runs.refetch()}
				ListHeaderComponent={
					<View style={{ gap: 12, paddingBottom: 16 }}>
						<Text style={styles.heading}>Saved Escape runs</Text>
						<Field
							label="Escape replay link"
							value={link}
							onChangeText={setLink}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
						<Button
							title="Open replay link"
							disabled={!link.trim()}
							secondary
							onPress={() => {
								try {
									const id = parseEscapeLink(link);
									setError(null);
									onReplay(id);
								} catch (cause) {
									setError(
										cause instanceof Error
											? cause
											: new Error("Invalid replay link."),
									);
								}
							}}
						/>
						<ErrorNotice error={error ?? runs.error} />
						{runs.isError && (
							<Button
								title="Retry loading runs"
								onPress={() => void runs.refetch()}
							/>
						)}
					</View>
				}
				ListEmptyComponent={
					runs.isPending ? (
						<Loading />
					) : (
						<Text style={styles.muted}>
							Finished runs from this workspace will appear here.
						</Text>
					)
				}
				ListFooterComponent={
					runs.hasNextPage ? (
						<Button
							title="Load more runs"
							busy={runs.isFetchingNextPage}
							onPress={() => void runs.fetchNextPage()}
						/>
					) : undefined
				}
				renderItem={({ item }) => (
					<View style={[styles.card, { marginBottom: 12 }]}>
						<Text style={styles.heading}>
							{getLevel(item.levelId).name} · {item.outcome}
						</Text>
						<Text style={styles.body}>{item.model}</Text>
						<Text style={styles.muted}>
							{item.steps} steps · Score {item.score} · ${item.cost.toFixed(4)}
						</Text>
						<Text style={styles.muted}>
							{new Date(item.createdAt).toLocaleString()}
						</Text>
						<Button
							title="Replay run"
							accessibilityLabel={`Replay ${getLevel(item.levelId).name}, ${item.outcome}, ${item.steps} steps`}
							secondary
							onPress={() => onReplay(item.id)}
						/>
					</View>
				)}
			/>
		</SafeAreaView>
	);
}
