import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { defaultAudioSettings, generateSpeech } from "@/api/audio";
import { api, client, queryClient } from "@/api/client";
import { AudioResult } from "@/components/AudioResult";
import { Choice } from "@/components/Choice";
import { ModelPicker } from "@/components/ModelPicker";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";

import { getModelAudioConfig } from "@llmgateway/shared/audio-generation-config";

import type { AudioGeneration, AudioHistoryItem } from "@/api/audio";
import type { AudioFormat } from "@llmgateway/shared/audio-generation-config";

export function AudioStudio({
	organizationId,
	projectId,
}: {
	organizationId: string;
	projectId: string;
}) {
	const [models, setModels] = useState([""]);
	const [settings, setSettings] = useState(() => defaultAudioSettings(""));
	const [prompt, setPrompt] = useState("");
	const [search, setSearch] = useState("");
	const [generation, setGeneration] = useState<AudioGeneration>();
	const [selected, setSelected] = useState<AudioHistoryItem>();
	const [unsaved, setUnsaved] = useState(false);
	const config = getModelAudioConfig(models[0]);
	const history = api.useQuery("get", "/playground/audio-history", {
		params: { query: { organizationId } },
	});
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: ["get", "/playground/audio-history"],
		});
	const save = useMutation({
		mutationFn: async (value: AudioGeneration) => {
			await client.POST("/playground/audio-history", { body: value });
			setUnsaved(false);
			await refresh();
		},
	});
	const generate = useMutation({
		mutationFn: async () => {
			if (!prompt.trim() || models.some((model) => !model)) {
				throw new Error("Choose an audio model and enter the words to speak.");
			}
			save.reset();
			setSelected(undefined);
			const value: AudioGeneration = {
				organizationId,
				prompt: prompt.trim(),
				voice: settings.voice,
				models: [],
			};
			setGeneration(value);
			const results = await Promise.all(
				models.map((model) =>
					generateSpeech(projectId, model, value.prompt, settings),
				),
			);
			const completed = { ...value, models: results };
			setGeneration(completed);
			setUnsaved(true);
			save.mutate(completed);
		},
	});
	const remove = api.useMutation("delete", "/playground/audio-history/{id}", {
		onSuccess: () => {
			setSelected(undefined);
			void refresh();
		},
	});
	const rename = api.useMutation("patch", "/playground/audio-history/{id}", {
		onSuccess: () => {
			setSelected(undefined);
			void refresh();
		},
	});
	const busy = generate.isPending || save.isPending;
	const display = selected ?? generation;
	return (
		<Screen>
			<Text style={styles.title}>Audio Studio</Text>
			<Text style={styles.muted}>
				Turn your words into speech and compare up to four models.
			</Text>
			{models.map((model, index) => (
				<View key={index} style={{ gap: 10 }}>
					<ModelPicker
						value={model}
						output="audio"
						label={`Audio model ${index + 1}`}
						disabled={busy}
						onChange={(value) => {
							setModels((current) =>
								current.map((entry, position) =>
									position === index ? value : entry,
								),
							);
							if (index === 0) {
								setSettings((current) => ({
									...defaultAudioSettings(value),
									instructions: current.instructions,
								}));
							}
						}}
					/>
					{index > 0 && (
						<Button
							title={`Remove audio model ${index + 1}`}
							secondary
							disabled={busy}
							onPress={() =>
								setModels((current) =>
									current.filter((_, position) => position !== index),
								)
							}
						/>
					)}
				</View>
			))}
			{models.length < 4 && (
				<Button
					title="Compare another audio model"
					secondary
					disabled={busy}
					onPress={() => setModels((current) => [...current, ""])}
				/>
			)}
			{models[0] && (
				<>
					<Choice
						label="Voice"
						value={settings.voice}
						options={config.voices}
						disabled={busy}
						onChange={(voice) =>
							setSettings((current) => ({ ...current, voice }))
						}
					/>
					<Choice
						label="Audio format"
						value={settings.format}
						options={config.availableFormats}
						disabled={busy}
						onChange={(format) =>
							setSettings((current) => ({
								...current,
								format: format as AudioFormat,
							}))
						}
					/>
					{config.supportsSpeed && (
						<Choice
							label="Speech speed"
							value={String(settings.speed)}
							options={config.availableSpeeds.map(String)}
							disabled={busy}
							onChange={(speed) =>
								setSettings((current) => ({ ...current, speed: Number(speed) }))
							}
						/>
					)}
					{config.supportsInstructions && (
						<Field
							label="Voice instructions"
							value={settings.instructions}
							editable={!busy}
							multiline
							onChangeText={(instructions) =>
								setSettings((current) => ({ ...current, instructions }))
							}
						/>
					)}
				</>
			)}
			{models.length > 1 && (
				<Text style={styles.muted}>
					Each model uses its default voice or format when it does not support
					your selection.
				</Text>
			)}
			<Field
				label="Words to speak"
				value={prompt}
				onChangeText={setPrompt}
				editable={!busy}
				multiline
			/>
			<Button
				title={generate.isPending ? "Generating speech…" : "Generate speech"}
				disabled={
					busy || unsaved || !prompt.trim() || models.some((model) => !model)
				}
				onPress={() => generate.mutate()}
			/>
			<ErrorNotice error={generate.error ?? save.error} />
			{unsaved && generation && (
				<Button
					title="Retry saving audio"
					disabled={save.isPending}
					onPress={() => save.mutate(generation)}
				/>
			)}
			{generate.isPending && <Loading />}
			{display && (
				<View style={{ gap: 12 }}>
					<Text style={styles.heading}>{display.prompt}</Text>
					{display.models.map((result, index) => (
						<AudioResult key={`${result.modelId}-${index}`} result={result} />
					))}
					<Button
						title="Use these words again"
						secondary
						disabled={busy}
						onPress={() => setPrompt(display.prompt)}
					/>
				</View>
			)}
			<Text style={styles.heading}>Audio history</Text>
			<Field label="Search audio" value={search} onChangeText={setSearch} />
			<ErrorNotice error={history.error ?? remove.error ?? rename.error} />
			{history.isPending && <Loading />}
			{history.data?.items
				.filter((item) =>
					item.prompt.toLowerCase().includes(search.toLowerCase()),
				)
				.map((item) => (
					<View key={item.id} style={styles.card}>
						<Button
							title={item.prompt}
							accessibilityLabel={`Play saved audio: ${item.prompt}`}
							secondary
							onPress={() => setSelected(item)}
						/>
						<Text style={styles.muted}>
							{new Date(item.createdAt).toLocaleString()} · {item.models.length}{" "}
							models
						</Text>
						<View style={styles.row}>
							<Button
								title="Rename audio"
								secondary
								onPress={() =>
									Alert.prompt(
										"Rename audio",
										undefined,
										(value) => {
											if (value.trim()) {
												rename.mutate({
													params: { path: { id: item.id } },
													body: { prompt: value.trim() },
												});
											}
										},
										"plain-text",
										item.prompt,
									)
								}
							/>
							<Button
								title="Delete audio"
								secondary
								onPress={() =>
									Alert.alert(
										"Delete this audio from history?",
										"Saved copies on your device are kept.",
										[
											{ text: "Cancel", style: "cancel" },
											{
												text: "Delete audio generation",
												style: "destructive",
												onPress: () =>
													remove.mutate({ params: { path: { id: item.id } } }),
											},
										],
									)
								}
							/>
						</View>
					</View>
				))}
		</Screen>
	);
}
