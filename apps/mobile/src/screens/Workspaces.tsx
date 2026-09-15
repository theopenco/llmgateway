import { useMutation } from "@tanstack/react-query";
import { Text, View } from "react-native";

import { api, client } from "@/api/client";
import { Button, ErrorNotice, Loading, Screen, styles } from "@/components/ui";

export interface Workspace {
	organizationId: string;
	projectId: string;
}
export function Workspaces({
	currentId,
	onSelect,
}: {
	currentId: string;
	onSelect: (workspace: Workspace) => void;
}) {
	const organizations = api.useQuery("get", "/orgs", {
		params: { query: { includeChat: "true" } },
	});
	const select = useMutation({
		mutationFn: async (organizationId: string) => {
			const { data } = await client.GET("/orgs/{id}/projects", {
				params: { path: { id: organizationId } },
			});
			const project = data?.projects.find((item) => item.status === "active");
			if (!project) {
				throw new Error(
					"This workspace has no active project. Create one on the website.",
				);
			}
			return { organizationId, projectId: project.id };
		},
		onSuccess: onSelect,
	});
	return (
		<Screen>
			<Text style={styles.title}>Your workspaces</Text>
			<Text style={styles.muted}>
				Choose which workspace your conversations and usage belong to.
			</Text>
			<ErrorNotice error={organizations.error ?? select.error} />
			{organizations.isPending && <Loading />}
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
						disabled={organization.id === currentId}
						busy={select.isPending && select.variables === organization.id}
						onPress={() => select.mutate(organization.id)}
					/>
				</View>
			))}
		</Screen>
	);
}
