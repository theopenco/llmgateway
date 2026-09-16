import { Image, FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { Button, colors, ErrorNotice, Loading, styles } from "@/components/ui";

export function Leaderboard() {
	const board = api.useQuery(
		"get",
		"/public/lounge-leaderboard",
		{ params: { query: { limit: 100 } } },
		{ refetchOnMount: "always" },
	);
	const points = api.useQuery(
		"get",
		"/lounge/points/me",
		{},
		{ refetchOnMount: "always" },
	);
	const user = api.useQuery("get", "/user/me", {});
	const refresh = () => {
		void board.refetch();
		void points.refetch();
	};
	return (
		<SafeAreaView style={styles.screen} edges={["bottom"]}>
			<FlatList
				data={board.data?.entries ?? []}
				keyExtractor={(entry) => entry.username}
				contentContainerStyle={styles.content}
				refreshing={board.isRefetching || points.isRefetching}
				onRefresh={refresh}
				ListHeaderComponent={
					<View style={{ gap: 12, paddingBottom: 16 }}>
						<Text style={styles.title}>Lounge leaderboard</Text>
						<Text style={styles.muted}>
							The top 100 public profiles, ranked by points earned creating and
							exploring.
						</Text>
						{points.data && (
							<Text style={styles.body}>
								{points.data.stats.rank
									? `Your global rank: #${points.data.stats.rank.toLocaleString()}`
									: "You are not ranked yet."}{" "}
								· {points.data.stats.totalPoints.toLocaleString()} points
							</Text>
						)}
						{points.data && (
							<Text style={styles.muted}>
								Level {points.data.stats.level} · {points.data.stats.levelTitle}{" "}
								· {points.data.stats.currentStreak} day streak
							</Text>
						)}
						<Text style={styles.muted}>
							Global rank also includes private profiles.
						</Text>
						<ErrorNotice error={board.error ?? points.error ?? user.error} />
						{(board.isError || points.isError || user.isError) && (
							<Button
								title="Retry loading leaderboard"
								onPress={() => {
									refresh();
									void user.refetch();
								}}
							/>
						)}
					</View>
				}
				ListEmptyComponent={
					board.isPending ? (
						<Loading />
					) : !board.isError ? (
						<Text style={styles.muted}>
							No public members have earned points yet.
						</Text>
					) : undefined
				}
				renderItem={({ item }) => (
					<View style={[styles.card, { marginBottom: 12 }]}>
						<View style={styles.row}>
							{item.image ? (
								<Image
									source={{ uri: item.image }}
									accessibilityIgnoresInvertColors
									style={{ width: 44, height: 44, borderRadius: 22 }}
								/>
							) : (
								<View
									style={{
										width: 44,
										height: 44,
										borderRadius: 22,
										backgroundColor: colors.border,
										alignItems: "center",
										justifyContent: "center",
									}}
								>
									<Text style={styles.body}>
										{(item.name?.trim() || item.username)
											.slice(0, 2)
											.toUpperCase()}
									</Text>
								</View>
							)}
							<View style={{ flex: 1, gap: 4 }}>
								<Text style={styles.heading}>
									#{item.rank} · {item.name?.trim() || item.username}
								</Text>
								<Text style={styles.muted}>
									@{item.username}
									{item.username === user.data?.user.username ? " · You" : ""}
								</Text>
							</View>
						</View>
						<Text style={styles.body}>
							{item.points.toLocaleString()} points
						</Text>
						<Text style={styles.muted}>
							Level {item.level} · {item.levelTitle}
						</Text>
					</View>
				)}
			/>
		</SafeAreaView>
	);
}
