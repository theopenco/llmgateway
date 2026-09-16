import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Text } from "react-native";

import { api, client } from "@/api/client";
import { clearSession } from "@/auth/session";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";

export function DeleteAccount({ onDeleted }: { onDeleted: () => void }) {
	const preview = api.useQuery("get", "/user/me/deletion-preview", {});
	const [confirmation, setConfirmation] = useState("");
	const remove = useMutation({
		mutationFn: async () => {
			await client.DELETE("/user/me", {});
			await clearSession();
		},
		onSuccess: onDeleted,
	});
	return (
		<Screen>
			<Text style={styles.title}>Delete account</Text>
			<Text style={styles.body}>
				This permanently deletes your LLM Gateway account across all its
				products, including Lounge.
			</Text>
			<ErrorNotice error={preview.error ?? remove.error} />
			{preview.isPending && <Loading />}
			{preview.data && (
				<>
					<Text style={styles.muted}>The following workspaces will close:</Text>
					{preview.data.organizations.map((organization) => (
						<Text key={organization.id} style={styles.body}>
							{organization.name}
						</Text>
					))}
					<Text style={styles.body}>
						{preview.data.activeSubscriptions} subscriptions will be cancelled.
						Remaining credits in the closed workspaces will be forfeited.
					</Text>
					<Field
						label="Type DELETE to confirm"
						autoCapitalize="characters"
						value={confirmation}
						onChangeText={setConfirmation}
					/>
					<Button
						title="Permanently delete account"
						disabled={confirmation !== "DELETE"}
						busy={remove.isPending}
						onPress={() =>
							Alert.alert(
								"Delete your account permanently?",
								"Your account and its personal data cannot be recovered.",
								[
									{ text: "Keep account", style: "cancel" },
									{
										text: "Delete account",
										style: "destructive",
										onPress: () => remove.mutate(),
									},
								],
							)
						}
					/>
				</>
			)}
		</Screen>
	);
}
