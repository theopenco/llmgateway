import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { Text, View } from "react-native";

import { api } from "@/api/client";
import { Button, ErrorNotice, Loading, Screen, styles } from "@/components/ui";
import { selectWorkspace } from "@/lib/workspace";

export function Workspaces({
	currentId,
	onSelect,
	onCancel,
	fullScreen,
}: {
	currentId?: string;
	onSelect: () => void;
	onCancel?: () => void;
	fullScreen?: boolean;
}) {
	const switching = useRef(false);
	const organizations = api.useQuery("get", "/orgs", {
		params: { query: { includeChat: "true" } },
	});
	const select = useMutation({
		mutationFn: selectWorkspace,
		onSuccess: onSelect,
		onSettled: () => {
			switching.current = false;
		},
	});
	return (
		<Screen fullScreen={fullScreen}>
			<Text style={styles.title}>Your workspaces</Text>
			<Text style={styles.muted}>
				Choose which workspace your conversations and usage belong to.
			</Text>
			<ErrorNotice error={organizations.error ?? select.error} />
			{organizations.isPending && <Loading />}
			{onCancel && <Button title="Back" secondary onPress={onCancel} />}
			{organizations.data?.organizations.map((organization) => (
				<View key={organization.id} style={styles.card}>
					<Text style={styles.heading}>
						{organization.kind === "chat"
							? "Personal Lounge"
							: organization.name}
					</Text>
					<Text style={styles.muted}>
						{organization.id === currentId
							? "Current workspace"
							: organization.kind === "chat"
								? "Your personal membership"
								: "Organization workspace"}
					</Text>
					<Button
						title={`Use ${organization.kind === "chat" ? "Personal Lounge" : organization.name}`}
						secondary
						disabled={organization.id === currentId || select.isPending}
						busy={select.isPending && select.variables === organization.id}
						onPress={() => {
							if (switching.current) {
								return;
							}
							switching.current = true;
							select.mutate(organization.id);
						}}
					/>
				</View>
			))}
		</Screen>
	);
}
