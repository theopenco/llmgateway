import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import { api, client, queryClient } from "@/api/client";
import { defaultImageSettings, generateImages } from "@/api/images";
import { Choice } from "@/components/Choice";
import { ImageOptions } from "@/components/ImageOptions";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";
import { exportImage } from "@/lib/export-image";
import { pickFile } from "@/lib/files";

import { getModelImageConfig } from "@llmgateway/shared/image-generation-config";

import type { GeneratedImage, ImageResult } from "@/api/images";

interface Generation {
	prompt: string;
	inputs: GeneratedImage[];
	models: ImageResult[];
}

export function ImageStudio({
	organizationId,
	projectId,
}: {
	organizationId: string;
	projectId: string;
}) {
	const [prompt, setPrompt] = useState("");
	const [settings, setSettings] = useState(() => [defaultImageSettings()]);
	const [count, setCount] = useState("1");
	const [inputs, setInputs] = useState<GeneratedImage[]>([]);
	const [selectedId, setSelectedId] = useState<string>();
	const [generation, setGeneration] = useState<Generation>();
	const [unsaved, setUnsaved] = useState(false);
	const [search, setSearch] = useState("");
	const history = api.useQuery("get", "/playground/image-history", {
		params: { query: { organizationId } },
	});
	const detail = api.useQuery(
		"get",
		"/playground/image-history/{id}",
		{ params: { path: { id: selectedId ?? "" } } },
		{ enabled: !!selectedId },
	);
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: ["get", "/playground/image-history"],
		});
	const save = useMutation({
		mutationFn: async (result: Generation) => {
			await client.POST("/playground/image-history", {
				body: {
					organizationId,
					prompt: result.prompt,
					models: result.models,
					inputImages: result.inputs.map((image) => ({
						dataUrl: `data:${image.mediaType};base64,${image.base64}`,
						mediaType: image.mediaType,
					})),
				},
			});
			setUnsaved(false);
			await refresh();
		},
	});
	const generate = useMutation({
		mutationFn: async () => {
			setSelectedId(undefined);
			save.reset();
			const result: Generation = { prompt: prompt.trim(), inputs, models: [] };
			setGeneration(result);
			const models = await Promise.all(
				settings.map(async (options) => {
					try {
						return await generateImages(
							projectId,
							result.prompt,
							options,
							result.inputs,
							Number(count),
						);
					} catch (error) {
						return {
							modelId: options.model,
							modelName: options.model,
							images: [],
							error:
								error instanceof Error
									? error.message
									: "Image generation failed.",
						};
					}
				}),
			);
			const completed = { ...result, models };
			setGeneration(completed);
			setUnsaved(true);
			save.mutate(completed);
		},
	});
	const attach = useMutation({
		mutationFn: async () => {
			const file = await pickFile([
				"public.png",
				"public.jpeg",
				"org.webmproject.webp",
			]);
			if (file) {
				setInputs((current) => [
					...current,
					{ base64: file.base64, mediaType: file.mimeType },
				]);
			}
		},
	});
	const exportFile = useMutation({
		mutationFn: ({
			image,
			action,
		}: {
			image: GeneratedImage;
			action: "save" | "share";
		}) => exportImage(image, action),
	});
	const remove = api.useMutation("delete", "/playground/image-history/{id}", {
		onSuccess: () => {
			setSelectedId(undefined);
			void refresh();
		},
	});
	const rename = api.useMutation("patch", "/playground/image-history/{id}", {
		onSuccess: async () => {
			await refresh();
			await queryClient.invalidateQueries({
				queryKey: ["get", "/playground/image-history/{id}"],
			});
		},
	});
	const displayed = selectedId ? detail.data?.item.models : generation?.models;
	const displayedPrompt = selectedId
		? detail.data?.item.prompt
		: generation?.prompt;
	const inputLimit = Math.min(
		...settings.map((item) => getModelImageConfig(item.model).maxInputImages),
	);
	const busy = generate.isPending || save.isPending;
	return (
		<Screen>
			<Text style={styles.eyebrow}>IMAGE STUDIO</Text>
			<Text style={styles.title}>Picture something new.</Text>
			{settings.map((item, index) => (
				<View key={index} style={{ gap: 10 }}>
					<ImageOptions
						value={item}
						onChange={(value) =>
							setSettings((current) =>
								current.map((option, i) => (i === index ? value : option)),
							)
						}
					/>
					{index > 0 && (
						<Button
							title={`Remove model ${index + 1}`}
							secondary
							disabled={busy}
							onPress={() =>
								setSettings((current) => current.filter((_, i) => i !== index))
							}
						/>
					)}
				</View>
			))}
			{settings.length < 4 && (
				<Button
					title="Compare another model"
					secondary
					disabled={busy}
					onPress={() =>
						setSettings((current) => [...current, defaultImageSettings()])
					}
				/>
			)}
			<Field
				label="Image prompt"
				value={prompt}
				onChangeText={setPrompt}
				multiline
				style={{ minHeight: 110 }}
			/>
			<Choice
				label="Images per model"
				value={count}
				options={["1", "2", "3", "4"]}
				onChange={setCount}
				disabled={busy}
			/>
			<Button
				title="Add reference image"
				secondary
				busy={attach.isPending}
				disabled={busy || inputs.length >= inputLimit}
				onPress={() => attach.mutate()}
			/>
			{inputs.map((image, index) => (
				<View key={index} style={styles.card}>
					<Image
						accessibilityLabel={`Reference image ${index + 1}`}
						source={{ uri: `data:${image.mediaType};base64,${image.base64}` }}
						style={{ height: 100 }}
						resizeMode="contain"
					/>
					<Button
						title={`Remove reference ${index + 1}`}
						secondary
						disabled={busy}
						onPress={() =>
							setInputs((current) => current.filter((_, i) => i !== index))
						}
					/>
				</View>
			))}
			{inputs.length > inputLimit && (
				<ErrorNotice
					error={
						new Error(
							`Remove references to meet the ${inputLimit}-image limit.`,
						)
					}
				/>
			)}
			<Button
				title={inputs.length ? "Edit images" : "Generate image"}
				disabled={!prompt.trim() || inputs.length > inputLimit || unsaved}
				busy={busy}
				onPress={() => generate.mutate()}
			/>
			<ErrorNotice
				error={
					generate.error ??
					attach.error ??
					exportFile.error ??
					history.error ??
					detail.error ??
					remove.error ??
					rename.error
				}
			/>
			{save.error && (
				<View style={styles.card}>
					<Text style={styles.body}>
						Your images are ready, but history could not be saved. Save or share
						them below, or retry saving history.
					</Text>
					<ErrorNotice error={save.error} />
					<Button
						title="Retry saving history"
						busy={save.isPending}
						onPress={() => generation && save.mutate(generation)}
					/>
				</View>
			)}
			{generate.isPending && (
				<Text style={styles.muted}>
					Creating your images. This may take a moment.
				</Text>
			)}
			{selectedId && detail.isPending && <Loading />}
			{displayedPrompt && <Text style={styles.heading}>{displayedPrompt}</Text>}
			{displayed?.map((result, modelIndex) => (
				<View key={modelIndex} style={{ gap: 14 }}>
					<Text style={styles.body}>{result.modelName}</Text>
					<ErrorNotice error={result.error ? new Error(result.error) : null} />
					{result.images.map((image, index) => (
						<View key={index} style={styles.card}>
							<Image
								accessibilityLabel={`Generated image ${modelIndex + 1}.${index + 1}`}
								source={{
									uri: `data:${image.mediaType};base64,${image.base64}`,
								}}
								style={{ width: "100%", aspectRatio: 1, borderRadius: 18 }}
								resizeMode="contain"
							/>
							<Button
								title={`Save image ${modelIndex + 1}.${index + 1}`}
								secondary
								disabled={exportFile.isPending}
								onPress={() => exportFile.mutate({ image, action: "save" })}
							/>
							<Button
								title={`Share image ${modelIndex + 1}.${index + 1}`}
								secondary
								disabled={exportFile.isPending}
								onPress={() => exportFile.mutate({ image, action: "share" })}
							/>
							<Button
								title={`Edit image ${modelIndex + 1}.${index + 1}`}
								secondary
								disabled={busy}
								onPress={() => {
									setInputs([image]);
									setPrompt(displayedPrompt ?? "");
								}}
							/>
						</View>
					))}
				</View>
			))}
			<Text style={styles.heading}>Your image history</Text>
			<Field label="Search images" value={search} onChangeText={setSearch} />
			{history.isPending && <Loading />}
			{history.data?.items
				.filter((item) =>
					item.prompt.toLowerCase().includes(search.toLowerCase()),
				)
				.map((item) => (
					<View key={item.id} style={styles.card}>
						<Text style={styles.body}>{item.prompt}</Text>
						<Button
							title={`View ${item.prompt.slice(0, 50)}`}
							secondary
							onPress={() => setSelectedId(item.id)}
						/>
						<Button
							title="Rename image"
							secondary
							onPress={() =>
								Alert.prompt(
									"Rename generation",
									"Choose a name for this image history entry.",
									(name) => {
										if (!name.trim()) {
											Alert.alert(
												"Name required",
												"Enter a name for this generation.",
											);
											return;
										}
										rename.mutate({
											params: { path: { id: item.id } },
											body: { prompt: name.trim() },
										});
									},
									"plain-text",
									item.prompt,
								)
							}
						/>
						<Button
							title="Delete image"
							secondary
							onPress={() =>
								Alert.alert("Delete this generation?", item.prompt, [
									{ text: "Cancel", style: "cancel" },
									{
										text: "Delete generation",
										style: "destructive",
										onPress: () =>
											remove.mutate({ params: { path: { id: item.id } } }),
									},
								])
							}
						/>
					</View>
				))}
		</Screen>
	);
}
