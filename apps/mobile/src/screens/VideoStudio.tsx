import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, Switch, Text, View } from "react-native";

import { api, client, queryClient } from "@/api/client";
import { createVideo } from "@/api/videos";
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
import { VideoResult } from "@/components/VideoResult";
import { pickFile } from "@/lib/files";

import {
	getNormalizedVideoRequestSelection,
	getSupportedVideoRequestOptions,
	getSelectedVideoMappings,
	supportsVideoFrameInput,
	supportsVideoEndFrameInput,
	supportsVideoReferenceInput,
	supportsVideoReferenceVideoInput,
	supportsVideoReferenceAudioInput,
} from "@llmgateway/shared/video-generation-config";

import type { VideoGeneration, VideoHistoryItem } from "@/api/videos";
import type {
	VideoDuration,
	VideoInputImage,
	VideoInputMode,
	VideoSize,
} from "@llmgateway/shared/video-generation-config";

function referenceUrls(value: string) {
	const urls = value.split(/\s+/).filter(Boolean);
	if (urls.length > 3 || urls.some((url) => !/^https:\/\/[^\s]+$/.test(url))) {
		throw new Error(
			"Use up to three HTTPS reference URLs, separated by new lines.",
		);
	}
	return urls;
}

export function VideoStudio({
	organizationId,
	projectId,
}: {
	organizationId: string;
	projectId: string;
}) {
	const [prompt, setPrompt] = useState("");
	const [models, setModels] = useState([""]);
	const [size, setSize] = useState<VideoSize>("1280x720");
	const [duration, setDuration] = useState<VideoDuration>(8);
	const [audio, setAudio] = useState(true);
	const [mode, setMode] = useState<VideoInputMode>("none");
	const [start, setStart] = useState<VideoInputImage | null>(null);
	const [end, setEnd] = useState<VideoInputImage | null>(null);
	const [references, setReferences] = useState<VideoInputImage[]>([]);
	const [videoUrls, setVideoUrls] = useState("");
	const [audioUrls, setAudioUrls] = useState("");
	const [generation, setGeneration] = useState<VideoGeneration>();
	const [unsaved, setUnsaved] = useState(false);
	const [selected, setSelected] = useState<VideoHistoryItem>();
	const [search, setSearch] = useState("");
	const catalog = api.useQuery("get", "/internal/models", {});
	const history = api.useQuery("get", "/playground/video-history", {
		params: { query: { organizationId } },
	});
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: ["get", "/playground/video-history"],
		});
	const framesSupported = models.every(supportsVideoFrameInput);
	const endFrameSupported = models.every(supportsVideoEndFrameInput);
	const endFrame = endFrameSupported ? end : null;
	const referencesSupported = models.every(supportsVideoReferenceInput);
	const videosSupported = models.every(supportsVideoReferenceVideoInput);
	const audiosSupported = models.every(supportsVideoReferenceAudioInput);
	const imageRequired = models.some((selection) => {
		const id = selection.split(":")[0].split("/").pop();
		return catalog.data?.models.find((model) => model.id === id)
			?.imageInputRequired;
	});
	const canDisableAudio = models.every((selection) =>
		getSelectedVideoMappings(catalog.data?.models ?? [], selection).some(
			(mapping) => mapping.supportsVideoWithoutAudio === true,
		),
	);
	const canEnableAudio = models.every((selection) =>
		getSelectedVideoMappings(catalog.data?.models ?? [], selection).some(
			(mapping) => mapping.supportsVideoAudio !== false,
		),
	);
	const includeAudio = canEnableAudio && (!canDisableAudio || audio);
	const modes: VideoInputMode[] = [
		...(!imageRequired ? ["none" as const] : []),
		...(framesSupported ? ["frames" as const] : []),
		...(referencesSupported ? ["reference" as const] : []),
	];
	const inputMode = modes.includes(mode) ? mode : (modes[0] ?? "none");
	const options = getSupportedVideoRequestOptions(
		catalog.data?.models ?? [],
		models,
		inputMode,
	);
	const normalized = getNormalizedVideoRequestSelection(
		catalog.data?.models ?? [],
		models,
		inputMode,
		size,
		duration,
	);
	const save = useMutation({
		mutationFn: async (value: VideoGeneration) => {
			await client.POST("/playground/video-history", { body: value });
			setUnsaved(false);
			await refresh();
		},
	});
	const generate = useMutation({
		mutationFn: async () => {
			if (!normalized || models.some((model) => !model)) {
				throw new Error("Choose models with a shared video size and duration.");
			}
			if (inputMode === "frames" && !start) {
				throw new Error("Choose a starting frame.");
			}
			if (imageRequired && inputMode !== "frames" && !references.length) {
				throw new Error("This model requires a reference image.");
			}
			if (
				inputMode === "reference" &&
				references.length > (videosSupported ? 9 : 3)
			) {
				throw new Error(
					"Remove extra reference images for the selected models.",
				);
			}
			const referenceVideos =
				inputMode === "reference" && videosSupported
					? referenceUrls(videoUrls)
					: [];
			const referenceAudios =
				inputMode === "reference" && audiosSupported
					? referenceUrls(audioUrls)
					: [];
			if (
				inputMode === "reference" &&
				!references.length &&
				!referenceVideos.length &&
				!referenceAudios.length
			) {
				throw new Error("Add a reference image, video, or audio clip.");
			}
			save.reset();
			setSelected(undefined);
			const value: VideoGeneration = {
				organizationId,
				prompt: prompt.trim(),
				models: [],
				...(inputMode === "frames" && {
					frameInputs: { start, end: endFrame },
				}),
				...(inputMode === "reference" && { referenceImages: references }),
			};
			setGeneration(value);
			const results = await Promise.all(
				models.map((model) =>
					createVideo(projectId, {
						model,
						prompt: value.prompt,
						size: normalized.size,
						seconds: normalized.duration,
						audio: includeAudio,
						...(inputMode === "frames" &&
							start && {
								image: start.dataUrl,
								...(endFrame && { last_frame: endFrame.dataUrl }),
							}),
						...(inputMode === "reference" && {
							...(references.length > 0 && {
								reference_images: references.map((image) => image.dataUrl),
							}),
							...(referenceVideos.length > 0 && {
								reference_videos: referenceVideos,
							}),
							...(referenceAudios.length > 0 && {
								reference_audios: referenceAudios,
							}),
						}),
					}),
				),
			);
			const completed = { ...value, models: results };
			setGeneration(completed);
			setUnsaved(true);
			save.mutate(completed);
		},
	});
	const attach = useMutation({
		mutationFn: async (target: "start" | "end" | "reference") => {
			const file = await pickFile([
				"public.png",
				"public.jpeg",
				"org.webmproject.webp",
			]);
			if (!file) {
				return;
			}
			const image = {
				dataUrl: `data:${file.mimeType};base64,${file.base64}`,
				mediaType: file.mimeType,
			};
			if (target === "start") {
				setStart(image);
			} else if (target === "end") {
				setEnd(image);
			} else {
				setReferences((current) => [...current, image]);
			}
		},
	});
	const remove = api.useMutation("delete", "/playground/video-history/{id}", {
		onSuccess: () => {
			setSelected(undefined);
			void refresh();
		},
	});
	const rename = api.useMutation("patch", "/playground/video-history/{id}", {
		onSuccess: () => {
			setSelected(undefined);
			void refresh();
		},
	});
	const busy = generate.isPending || save.isPending;
	const display = selected ?? generation;
	return (
		<Screen>
			<Text style={styles.title}>Video Studio</Text>
			<Text style={styles.muted}>
				Create videos and compare up to three models. Jobs continue after you
				leave.
			</Text>
			{models.map((model, index) => (
				<View key={index} style={{ gap: 8 }}>
					<ModelPicker
						value={model}
						output="video"
						label={`Video model ${index + 1}`}
						disabled={busy}
						onChange={(value) =>
							setModels((current) =>
								current.map((item, position) =>
									position === index ? value : item,
								),
							)
						}
					/>
					{index > 0 && (
						<Button
							title={`Remove model ${index + 1}`}
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
			{models.length < 3 && (
				<Button
					title="Compare another video model"
					secondary
					disabled={busy}
					onPress={() => setModels((current) => [...current, ""])}
				/>
			)}
			<Choice
				label="Video inputs"
				value={inputMode}
				options={modes}
				onChange={setMode}
				disabled={busy}
			/>
			{inputMode === "frames" &&
				(
					["start", ...(endFrameSupported ? ["end" as const] : [])] as const
				).map((target) => {
					const image = target === "start" ? start : end;
					return (
						<View key={target} style={styles.card}>
							<Button
								title={`Choose ${target} frame`}
								secondary
								disabled={busy || attach.isPending}
								onPress={() => attach.mutate(target)}
							/>
							{image && (
								<>
									<Image
										source={{ uri: image.dataUrl }}
										accessibilityLabel={`${target} frame`}
										style={{ height: 120, width: "100%" }}
										resizeMode="contain"
									/>
									<Button
										title={`Remove ${target} frame`}
										secondary
										disabled={busy}
										onPress={() =>
											target === "start" ? setStart(null) : setEnd(null)
										}
									/>
								</>
							)}
						</View>
					);
				})}
			{inputMode === "reference" && (
				<View style={{ gap: 12 }}>
					{references.map((image, index) => (
						<View key={index} style={styles.card}>
							<Image
								source={{ uri: image.dataUrl }}
								accessibilityLabel={`Reference ${index + 1}`}
								style={{ height: 100, width: "100%" }}
								resizeMode="contain"
							/>
							<Button
								title={`Remove reference ${index + 1}`}
								secondary
								disabled={busy}
								onPress={() =>
									setReferences((current) =>
										current.filter((_, position) => position !== index),
									)
								}
							/>
						</View>
					))}
					<Button
						title="Add reference image"
						secondary
						disabled={
							busy ||
							attach.isPending ||
							references.length >= (videosSupported ? 9 : 3)
						}
						onPress={() => attach.mutate("reference")}
					/>
					{videosSupported && (
						<Field
							label="Reference video HTTPS URLs"
							value={videoUrls}
							onChangeText={setVideoUrls}
							multiline
							editable={!busy}
						/>
					)}
					{audiosSupported && (
						<Field
							label="Reference audio HTTPS URLs"
							value={audioUrls}
							onChangeText={setAudioUrls}
							multiline
							editable={!busy}
						/>
					)}
				</View>
			)}
			{normalized && (
				<>
					<Choice
						label="Video size"
						value={normalized.size}
						options={options.sizes}
						onChange={setSize}
						disabled={busy}
					/>
					<Choice
						label="Video seconds"
						value={String(normalized.duration)}
						options={options.durations.map(String)}
						onChange={(value) => setDuration(Number(value) as VideoDuration)}
						disabled={busy}
					/>
				</>
			)}
			{models.every(Boolean) && !normalized && (
				<Text style={styles.muted}>
					These models have no shared size and duration for the selected inputs.
				</Text>
			)}
			<View style={styles.row}>
				<Text style={styles.muted}>Generate audio</Text>
				<Switch
					accessibilityLabel="Generate audio"
					value={includeAudio}
					onValueChange={setAudio}
					disabled={busy || !canEnableAudio || !canDisableAudio}
				/>
			</View>
			<Field
				label="Video prompt"
				value={prompt}
				onChangeText={setPrompt}
				multiline
				editable={!busy}
			/>
			<Button
				title={generate.isPending ? "Starting video jobs…" : "Generate video"}
				disabled={busy || unsaved || !prompt.trim() || !normalized}
				onPress={() => generate.mutate()}
			/>
			<ErrorNotice
				error={generate.error ?? attach.error ?? catalog.error ?? save.error}
			/>
			{unsaved && generation && (
				<Button
					title="Retry saving video jobs"
					disabled={save.isPending}
					onPress={() => save.mutate(generation)}
				/>
			)}
			{display && (
				<View style={{ gap: 12 }}>
					<Text style={styles.heading}>{display.prompt}</Text>
					{display.models.map((result, index) => (
						<VideoResult
							key={`${result.jobId ?? result.modelId}-${index}`}
							result={result}
						/>
					))}
				</View>
			)}
			<Text style={styles.heading}>Video history</Text>
			<Field label="Search videos" value={search} onChangeText={setSearch} />
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
							secondary
							onPress={() => setSelected(item)}
						/>
						<Text style={styles.muted}>
							{new Date(item.createdAt).toLocaleString()} · {item.models.length}{" "}
							models
						</Text>
						<View style={styles.row}>
							<Button
								title="Rename video"
								secondary
								onPress={() =>
									Alert.prompt(
										"Rename video",
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
								title="Delete video"
								secondary
								onPress={() =>
									Alert.alert(
										"Delete this video from history?",
										"This does not cancel generation already in progress.",
										[
											{ text: "Cancel", style: "cancel" },
											{
												text: "Delete generation",
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
