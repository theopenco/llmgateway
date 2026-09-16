import { useState } from "react";
import { Alert, Switch, Text, View } from "react-native";

import { api, queryClient } from "@/api/client";
import { GenerateSkill } from "@/components/GenerateSkill";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";

export function Skills({ projectId }: { projectId: string }) {
	const list = api.useQuery("get", "/skills", {});
	const [id, setId] = useState<string>();
	const [editing, setEditing] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [instructions, setInstructions] = useState("");
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/skills"] });
	const saved = () => {
		setEditing(false);
		void refresh();
	};
	const create = api.useMutation("post", "/skills", { onSuccess: saved });
	const update = api.useMutation("patch", "/skills/{id}", {
		onSuccess: refresh,
	});
	const remove = api.useMutation("delete", "/skills/{id}", {
		onSuccess: refresh,
	});
	return (
		<Screen>
			<Text style={styles.title}>Your skills</Text>
			<Text style={styles.muted}>
				Reusable instructions for your conversations. Enabled skills follow you
				across workspaces.
			</Text>
			<ErrorNotice
				error={list.error ?? create.error ?? update.error ?? remove.error}
			/>
			{generating ? (
				<GenerateSkill
					projectId={projectId}
					onCancel={() => setGenerating(false)}
					onGenerated={(skill) => {
						setId(undefined);
						setName(skill.name);
						setDescription(skill.description);
						setInstructions(skill.instructions);
						setGenerating(false);
						setEditing(true);
					}}
				/>
			) : editing ? (
				<View style={styles.card}>
					<Field
						label="Skill name"
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
						label="Instructions"
						value={instructions}
						onChangeText={setInstructions}
						multiline
						style={{ minHeight: 140 }}
					/>
					<Button
						title="Save skill"
						busy={create.isPending || update.isPending}
						disabled={!name.trim() || !instructions.trim()}
						onPress={() =>
							id
								? update.mutate(
										{
											params: { path: { id } },
											body: { name, description, instructions },
										},
										{ onSuccess: saved },
									)
								: create.mutate({
										body: { name, description, instructions, enabled: true },
									})
						}
					/>
					<Button title="Cancel" secondary onPress={() => setEditing(false)} />
				</View>
			) : (
				<View style={{ gap: 12 }}>
					<Button title="Generate skill" onPress={() => setGenerating(true)} />
					<Button
						title="Create skill"
						onPress={() => {
							setId(undefined);
							setName("");
							setDescription("");
							setInstructions("");
							setEditing(true);
						}}
					/>
				</View>
			)}
			{list.isPending && <Loading />}
			{!editing &&
				!generating &&
				list.data?.skills.map((skill) => (
					<View key={skill.id} style={styles.card}>
						<View style={[styles.row, { justifyContent: "space-between" }]}>
							<Text style={[styles.heading, { flex: 1 }]}>{skill.name}</Text>
							<Switch
								accessibilityLabel={`Enable ${skill.name}`}
								value={skill.enabled}
								disabled={update.isPending}
								onValueChange={(enabled) =>
									update.mutate({
										params: { path: { id: skill.id } },
										body: { enabled },
									})
								}
							/>
						</View>
						<Text style={styles.muted}>{skill.description}</Text>
						<Button
							title={`Edit ${skill.name}`}
							secondary
							onPress={() => {
								setId(skill.id);
								setName(skill.name);
								setDescription(skill.description);
								setInstructions(skill.instructions);
								setEditing(true);
							}}
						/>
						<Button
							title={`Delete ${skill.name}`}
							secondary
							onPress={() =>
								Alert.alert("Delete skill?", skill.name, [
									{ text: "Cancel", style: "cancel" },
									{
										text: "Delete",
										style: "destructive",
										onPress: () =>
											remove.mutate({ params: { path: { id: skill.id } } }),
									},
								])
							}
						/>
					</View>
				))}
			{list.data?.skills.length === 0 && (
				<Text style={styles.muted}>
					No skills yet. Create one to reuse your instructions.
				</Text>
			)}
		</Screen>
	);
}
