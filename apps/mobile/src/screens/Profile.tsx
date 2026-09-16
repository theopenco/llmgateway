import { useMutation } from "@tanstack/react-query";
import { Linking, Text, View } from "react-native";

import { api } from "@/api/client";
import { signOut } from "@/auth/session";
import { ProfileProgress } from "@/components/ProfileProgress";
import { PublicProfile } from "@/components/PublicProfile";
import { Button, ErrorNotice, Loading, Screen, styles } from "@/components/ui";
import { config } from "@/config";

export function Profile({
	onSignedOut,
	onDelete,
	onLeaderboard,
}: {
	onSignedOut: () => void;
	onDelete: () => void;
	onLeaderboard: () => void;
}) {
	const user = api.useQuery("get", "/user/me", {});
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
			<ErrorNotice error={user.error ?? logout.error ?? website.error} />
			{user.isPending && <Loading />}
			{user.isError && (
				<Button
					title="Retry loading profile"
					onPress={() => void user.refetch()}
				/>
			)}
			<View style={styles.card}>
				<Text style={styles.eyebrow}>MEMBER PROFILE</Text>
				<Text style={styles.heading}>{user.data?.user.name}</Text>
				<Text style={styles.muted}>
					{user.data?.user.username
						? `@${user.data.user.username}`
						: user.data?.user.email}
				</Text>
			</View>
			<PublicProfile onLeaderboard={onLeaderboard} />
			<ProfileProgress />
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
