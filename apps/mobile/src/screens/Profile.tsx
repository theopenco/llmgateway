import { useMutation } from "@tanstack/react-query";
import { Linking, Text, View } from "react-native";

import { api } from "@/api/client";
import { signOut } from "@/auth/session";
import { Button, ErrorNotice, Loading, Screen, styles } from "@/components/ui";
import { config } from "@/config";

export function Profile({
	onSignedOut,
	onDelete,
}: {
	onSignedOut: () => void;
	onDelete: () => void;
}) {
	const user = api.useQuery("get", "/user/me", {});
	const leaderboard = api.useQuery("get", "/public/lounge-leaderboard", {
		params: { query: { limit: 10 } },
	});
	const points = api.useQuery("get", "/lounge/points/me", {});
	const logout = useMutation({
		mutationFn: signOut,
		onSuccess: () => {
			onSignedOut();
		},
	});
	const website = useMutation({
		mutationFn: () => Linking.openURL(config.webUrl),
	});
	return (
		<Screen>
			<Text style={styles.title}>Your Lounge</Text>
			<ErrorNotice
				error={
					user.error ??
					points.error ??
					leaderboard.error ??
					logout.error ??
					website.error
				}
			/>
			{user.isPending && <Loading />}
			<View style={styles.card}>
				<Text style={styles.eyebrow}>MEMBER PROFILE</Text>
				<Text style={styles.heading}>{user.data?.user.name}</Text>
				<Text style={styles.muted}>{user.data?.user.email}</Text>
			</View>
			{points.data && (
				<View style={styles.card}>
					<Text style={styles.eyebrow}>YOUR PROGRESS</Text>
					<Text style={styles.title}>
						{points.data.stats.totalPoints} points
					</Text>
					<Text style={styles.muted}>
						Keep creating, learning, and exploring.
					</Text>
				</View>
			)}
			{points.data && (
				<View style={styles.card}>
					<Text style={styles.heading}>
						Level {points.data.stats.level} · {points.data.stats.levelTitle}
					</Text>
					<Text style={styles.muted}>
						{points.data.stats.currentStreak} day streak ·{" "}
						{points.data.stats.activeDays} active days
					</Text>
					<Text style={styles.muted}>
						{points.data.stats.nextLevelAt - points.data.stats.totalPoints}{" "}
						points to the next level
					</Text>
				</View>
			)}
			<Text style={styles.heading}>Lounge leaderboard</Text>
			{leaderboard.data?.entries.map((entry) => (
				<View key={entry.username} style={styles.card}>
					<Text style={styles.body}>
						#{entry.rank} · {entry.name ?? entry.username}
					</Text>
					<Text style={styles.muted}>
						{entry.points} points · {entry.levelTitle}
					</Text>
				</View>
			))}
			<Text style={styles.muted}>
				Manage your membership and billing on the Lounge website.
			</Text>
			<Button
				title="Open the Lounge website"
				secondary
				onPress={() => website.mutate()}
			/>
			<Button
				title="Sign out"
				secondary
				onPress={() => logout.mutate()}
				busy={logout.isPending}
			/>
			<Button title="Delete account" secondary onPress={onDelete} />
			<Text style={styles.muted}>The Lounge by LLM Gateway</Text>
		</Screen>
	);
}
