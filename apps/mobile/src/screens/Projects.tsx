import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { api, queryClient } from "@/api/client";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";

export function Projects({
	organizationId,
	onProject,
}: {
	organizationId: string;
	onProject: (id: string) => void;
}) {
	const projects = api.useQuery("get", "/chat-projects", {
		params: { query: { organizationId } },
	});
	const [id, setId] = useState<string>();
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [instructions, setInstructions] = useState("");
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/chat-projects"] });
	const saved = () => {
		setEditing(false);
		void refresh();
	};
	const create = api.useMutation("post", "/chat-projects", {
		onSuccess: saved,
	});
	const update = api.useMutation("patch", "/chat-projects/{id}", {
		onSuccess: saved,
	});
	const remove = api.useMutation("delete", "/chat-projects/{id}", {
		onSuccess: refresh,
	});
	return (
		<Screen>
			<Text style={styles.title}>Projects</Text>
			<Text style={styles.muted}>
				A home for the context behind your conversations.
			</Text>
			<ErrorNotice
				error={projects.error ?? create.error ?? update.error ?? remove.error}
			/>
			{editing ? (
				<View style={styles.card}>
					<Field
						label="Project name"
						value={name}
						onChangeText={setName}
						maxLength={100}
					/>
					<Field
						label="Description"
						value={description}
						onChangeText={setDescription}
						maxLength={2000}
					/>
					<Field
						label="Project instructions"
						value={instructions}
						onChangeText={setInstructions}
						maxLength={20000}
						multiline
						style={{ minHeight: 120 }}
					/>
					<Button
						title="Save project"
						disabled={!name.trim()}
						busy={create.isPending || update.isPending}
						onPress={() =>
							id
								? update.mutate({
										params: { path: { id } },
										body: { name, description, instructions },
									})
								: create.mutate({
										body: { name, description, instructions, organizationId },
									})
						}
					/>
					<Button title="Cancel" secondary onPress={() => setEditing(false)} />
				</View>
			) : (
				<Button
					title="Create project"
					onPress={() => {
						setId(undefined);
						setName("");
						setDescription("");
						setInstructions("");
						setEditing(true);
					}}
				/>
			)}
			{projects.isPending && <Loading />}
			{projects.data?.projects.map((project) => (
				<View key={project.id} style={styles.card}>
					<Text style={styles.heading}>{project.name}</Text>
					<Button
						title={`Open ${project.name}`}
						secondary
						onPress={() => onProject(project.id)}
					/>
					<Text style={styles.muted}>{project.description}</Text>
					<Text style={styles.muted}>
						{project.fileCount} files · {project.chatCount} conversations
					</Text>
					<Button
						title={`Edit ${project.name}`}
						secondary
						onPress={() => {
							setId(project.id);
							setName(project.name);
							setDescription(project.description);
							setInstructions(project.instructions);
							setEditing(true);
						}}
					/>
					<Button
						title={`Delete ${project.name}`}
						secondary
						onPress={() =>
							Alert.alert(
								"Delete project?",
								"This removes the project and its knowledge files.",
								[
									{ text: "Cancel", style: "cancel" },
									{
										text: "Delete",
										style: "destructive",
										onPress: () =>
											remove.mutate({ params: { path: { id: project.id } } }),
									},
								],
							)
						}
					/>
				</View>
			))}
			{projects.data?.projects.length === 0 && (
				<Text style={styles.muted}>
					Start a project to keep related ideas together.
				</Text>
			)}
		</Screen>
	);
}
