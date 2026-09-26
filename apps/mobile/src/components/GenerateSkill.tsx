import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { client } from "@/api/client";
import { ensureGatewayKey } from "@/api/gateway-key";
import { Button, ErrorNotice, Field, styles } from "@/components/ui";

interface SkillDraft {
	name: string;
	description: string;
	instructions: string;
}

export function GenerateSkill({
	projectId,
	onGenerated,
	onCancel,
}: {
	projectId: string;
	onGenerated: (skill: SkillDraft) => void;
	onCancel: () => void;
}) {
	const [prompt, setPrompt] = useState("");
	const request = useRef<AbortController | null>(null);
	useEffect(() => () => request.current?.abort(), []);
	const generate = useMutation({
		mutationFn: async () => {
			const controller = new AbortController();
			request.current = controller;
			const timeout = setTimeout(() => controller.abort(), 125_000);
			try {
				const token = await ensureGatewayKey(projectId);
				const { data } = await client.POST("/skills/generate", {
					body: { prompt: prompt.trim() },
					headers: { "x-llmgateway-key": token },
					signal: controller.signal,
				});
				if (!data) {
					throw new Error(
						"The skill draft was not returned. Please try again.",
					);
				}
				if (!controller.signal.aborted) {
					onGenerated(data.skill);
				}
			} finally {
				clearTimeout(timeout);
			}
		},
	});
	return (
		<View style={styles.card}>
			<Text style={styles.heading}>Generate a skill</Text>
			<Text style={styles.muted}>
				Describe how you want the assistant to work. Review and edit the draft
				before saving it.
			</Text>
			<ErrorNotice error={generate.error} />
			<Field
				label="What should this skill do?"
				value={prompt}
				onChangeText={setPrompt}
				multiline
				editable={!generate.isPending}
				style={{ minHeight: 140 }}
			/>
			<Button
				title="Generate draft"
				busy={generate.isPending}
				disabled={!prompt.trim()}
				onPress={() => generate.mutate()}
			/>
			<Button
				title="Cancel generation"
				secondary
				onPress={() => {
					request.current?.abort();
					onCancel();
				}}
			/>
		</View>
	);
}
