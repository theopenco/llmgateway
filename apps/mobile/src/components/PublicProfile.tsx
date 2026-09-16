import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Switch, Text, View } from "react-native";

import { api } from "@/api/client";
import { Button, ErrorNotice, Field, styles } from "@/components/ui";

export function PublicProfile({
	onLeaderboard,
}: {
	onLeaderboard: () => void;
}) {
	const queryClient = useQueryClient();
	const user = api.useQuery("get", "/user/me", {});
	const [username, setUsername] = useState("");
	const [validation, setValidation] = useState<string>();
	const update = api.useMutation("patch", "/user/me", {
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: ["get", "/user/me"] }),
				queryClient.invalidateQueries({
					queryKey: ["get", "/lounge/points/me"],
				}),
				queryClient.invalidateQueries({
					queryKey: ["get", "/public/lounge-leaderboard"],
				}),
			]);
		},
	});
	const member = user.data?.user;
	if (!member) {
		return null;
	}
	const isPublic = Boolean(member.profilePublic && member.username);
	return (
		<View style={styles.card}>
			<Text style={styles.heading}>Public profile</Text>
			<Text style={styles.muted}>
				Joining makes your username, name, picture, level, and points public.
				Your chats stay private.
			</Text>
			<ErrorNotice
				error={update.error ?? (validation ? new Error(validation) : undefined)}
			/>
			{isPublic ? (
				<>
					<Text style={styles.body}>
						Your profile is public as @{member.username}.
					</Text>
					<View style={styles.row}>
						<Text style={[styles.body, { flex: 1 }]}>
							Hide my profile picture
						</Text>
						<Switch
							testID="profile-picture-switch"
							accessibilityLabel="Hide my profile picture"
							value={member.profileHidePicture}
							disabled={update.isPending}
							onValueChange={(profileHidePicture) =>
								update.mutate({ body: { profileHidePicture } })
							}
						/>
					</View>
					<Button
						title="Make profile private"
						secondary
						busy={update.isPending}
						onPress={() => update.mutate({ body: { profilePublic: false } })}
					/>
				</>
			) : (
				<>
					<Text style={styles.body}>Your profile is private.</Text>
					{member.username ? (
						<Text style={styles.muted}>Username: @{member.username}</Text>
					) : (
						<Field
							label="Public username"
							value={username}
							onChangeText={(value) => {
								setUsername(value);
								setValidation(undefined);
							}}
							autoCapitalize="none"
							autoCorrect={false}
							maxLength={30}
							editable={!update.isPending}
							placeholder="pick-a-username"
						/>
					)}
					<Button
						title="Join the leaderboard"
						busy={update.isPending}
						onPress={() => {
							const normalized = (member.username ?? username)
								.trim()
								.toLowerCase();
							if (!/^[a-z0-9_-]{3,30}$/.test(normalized)) {
								update.reset();
								setValidation(
									"Use 3–30 letters, numbers, hyphens, or underscores.",
								);
								return;
							}
							setValidation(undefined);
							update.mutate({
								body: member.username
									? { profilePublic: true }
									: { username: normalized, profilePublic: true },
							});
						}}
					/>
				</>
			)}
			<Button title="View leaderboard" secondary onPress={onLeaderboard} />
		</View>
	);
}
