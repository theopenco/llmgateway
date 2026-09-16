import { Text, View } from "react-native";

import { api } from "@/api/client";
import { Button, colors, ErrorNotice, Loading, styles } from "@/components/ui";

import {
	LOUNGE_ACTIVITIES,
	loungeActivity,
} from "@llmgateway/shared/lounge-points";

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<View
			style={[styles.card, { flexGrow: 1, flexBasis: "45%" }]}
			accessible
			accessibilityLabel={`${label}: ${value}`}
		>
			<Text style={styles.muted}>{label}</Text>
			<Text style={styles.heading}>{value}</Text>
		</View>
	);
}

export function ProfileProgress() {
	const points = api.useQuery(
		"get",
		"/lounge/points/me",
		{},
		{ refetchOnMount: "always" },
	);
	const stats = points.data?.stats;
	const span = stats ? stats.nextLevelAt - stats.currentLevelAt : 0;
	const progress =
		stats && span > 0
			? Math.max(
					0,
					Math.min(
						100,
						Math.round(
							((stats.totalPoints - stats.currentLevelAt) / span) * 100,
						),
					),
				)
			: 0;
	return (
		<>
			<ErrorNotice error={points.error} />
			{points.isPending && <Loading />}
			{points.isError && (
				<Button
					title="Retry loading points"
					onPress={() => void points.refetch()}
				/>
			)}
			{stats && (
				<>
					<View style={styles.card}>
						<Text style={styles.eyebrow}>YOUR PROGRESS</Text>
						<Text style={styles.title}>
							{stats.totalPoints.toLocaleString()} points
						</Text>
						<Text style={styles.heading}>
							Level {stats.level} · {stats.levelTitle}
						</Text>
						<View
							accessible
							role="progressbar"
							accessibilityLabel="Progress to next level"
							accessibilityValue={{ min: 0, max: 100, now: progress }}
							style={{
								height: 8,
								borderRadius: 4,
								backgroundColor: colors.border,
								overflow: "hidden",
							}}
						>
							<View
								style={{
									height: 8,
									backgroundColor: colors.accent,
									width: `${progress}%`,
								}}
							/>
						</View>
						<Text style={styles.muted}>
							{Math.max(
								0,
								stats.nextLevelAt - stats.totalPoints,
							).toLocaleString()}{" "}
							points to level {stats.level + 1}
						</Text>
					</View>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
						<Stat
							label="Today"
							value={`+${stats.todayPoints.toLocaleString()} points`}
						/>
						<Stat
							label="Global rank"
							value={
								stats.rank ? `#${stats.rank.toLocaleString()}` : "Unranked"
							}
						/>
						<Stat
							label="Current streak"
							value={`${stats.currentStreak} days`}
						/>
						<Stat
							label="Longest streak"
							value={`${stats.longestStreak} days`}
						/>
						<Stat label="Active days" value={String(stats.activeDays)} />
					</View>
					<Text style={styles.heading}>Points earned</Text>
					{stats.breakdown.length === 0 && (
						<Text style={styles.muted}>
							No points yet. Send a message or create something to get started.
						</Text>
					)}
					{stats.breakdown.map((row) => (
						<View style={styles.card} key={row.kind}>
							<Text style={styles.body}>
								{loungeActivity(row.kind)?.label ?? row.kind}
							</Text>
							<Text style={styles.muted}>
								{row.count.toLocaleString()} activities ·{" "}
								{row.points.toLocaleString()} points
							</Text>
						</View>
					))}
				</>
			)}
			<View style={styles.card}>
				<Text style={styles.heading}>How to earn points</Text>
				{Object.values(LOUNGE_ACTIVITIES).map((activity) => (
					<View style={styles.row} key={activity.action}>
						<Text style={[styles.body, { flex: 1 }]}>{activity.action}</Text>
						<Text style={styles.body}>+{activity.points}</Text>
					</View>
				))}
				<Text style={styles.muted}>
					Daily caps apply per activity. Streaks grow for every day you show up.
				</Text>
			</View>
		</>
	);
}
