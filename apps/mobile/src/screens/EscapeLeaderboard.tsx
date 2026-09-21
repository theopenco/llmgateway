import { useState } from "react";
import { ActionSheetIOS, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { Button, ErrorNotice, Loading, styles } from "@/components/ui";

import { ESCAPE_LEVELS, getLevel } from "@llmgateway/shared/sandbox-escape";

export function EscapeLeaderboard() {
	const [levelId, setLevelId] = useState<number>();
	const board = api.useQuery(
		"get",
		"/public/escape/leaderboard",
		{ params: { query: { levelId, limit: 100 } } },
		{ refetchOnMount: "always" },
	);
	return (
		<SafeAreaView style={styles.screen} edges={["bottom"]}>
			<FlatList
				data={board.data?.entries ?? []}
				keyExtractor={(entry) => entry.model}
				contentContainerStyle={styles.content}
				refreshing={board.isRefetching}
				onRefresh={() => void board.refetch()}
				ListHeaderComponent={
					<View style={{ gap: 12, paddingBottom: 16 }}>
						<Text style={styles.heading}>Escape rankings</Text>
						<Text style={styles.muted}>
							Models ranked by their recorded runs.
						</Text>
						<Button
							title={
								levelId ? `Level: ${getLevel(levelId).name}` : "All levels"
							}
							secondary
							onPress={() =>
								ActionSheetIOS.showActionSheetWithOptions(
									{
										title: "Rankings filter",
										options: [
											"Cancel",
											"All levels",
											...ESCAPE_LEVELS.map((level) => level.name),
										],
										cancelButtonIndex: 0,
									},
									(index) => {
										if (index > 0) {
											setLevelId(
												index === 1 ? undefined : ESCAPE_LEVELS[index - 2].id,
											);
										}
									},
								)
							}
						/>
						{board.data && (
							<Text style={styles.body}>
								{board.data.totalEscapes} escapes / {board.data.totalRuns} runs
							</Text>
						)}
						<ErrorNotice error={board.error} />
						{board.isError && (
							<Button
								title="Retry loading rankings"
								onPress={() => void board.refetch()}
							/>
						)}
					</View>
				}
				ListEmptyComponent={
					board.isPending ? (
						<Loading />
					) : (
						<Text style={styles.muted}>No ranked runs for this level yet.</Text>
					)
				}
				renderItem={({ item }) => (
					<View style={[styles.card, { marginBottom: 12 }]}>
						<Text style={styles.heading}>
							#{item.rank} · {item.model}
						</Text>
						<Text style={styles.body}>
							{(item.successRate * 100).toFixed(1)}% success · {item.escapes} /{" "}
							{item.runs} runs
						</Text>
						<Text style={styles.muted}>
							Average score {item.avgScore.toFixed(1)} · Best score{" "}
							{item.bestScore}
						</Text>
						<Text style={styles.muted}>
							Best escape {item.bestSteps ?? "—"} steps · Average cost $
							{item.avgCost.toFixed(4)}
						</Text>
					</View>
				)}
			/>
		</SafeAreaView>
	);
}
