import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import { api, client, queryClient } from "@/api/client";
import { gatewayClient, imageMediaType } from "@/api/gateway";
import { ModelPicker } from "@/components/ModelPicker";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";

export function ImageStudio({
	organizationId,
	projectId,
}: {
	organizationId: string;
	projectId: string;
}) {
	const [prompt, setPrompt] = useState("");
	const [model, setModel] = useState("auto");
	const [aspectRatio, setAspectRatio] = useState("1:1");
	const [selectedId, setSelectedId] = useState<string>();
	const [images, setImages] = useState<
		Array<{ base64: string; mediaType: string }>
	>([]);
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
	const generate = useMutation({
		mutationFn: async () => {
			setSelectedId(undefined);
			const gateway = await gatewayClient(projectId);
			const { data } = await gateway.POST("/v1/images/generations", {
				body: {
					model,
					prompt: prompt.trim(),
					aspect_ratio: aspectRatio,
					n: 1,
					response_format: "b64_json",
				},
			});
			if (!data?.data?.length) {
				throw new Error("The model returned no images. Please try again.");
			}
			const result = data.data.map((item) => ({
				base64: item.b64_json,
				mediaType: imageMediaType(item.b64_json),
			}));
			setImages(result);
			await client.POST("/playground/image-history", {
				body: {
					organizationId,
					prompt: prompt.trim(),
					models: [{ modelId: model, modelName: model, images: result }],
				},
			});
			await refresh();
		},
	});
	const remove = api.useMutation("delete", "/playground/image-history/{id}", {
		onSuccess: () => {
			setSelectedId(undefined);
			void refresh();
		},
	});
	const displayed = selectedId
		? (detail.data?.item.models.flatMap((item) => item.images) ?? [])
		: images;
	return (
		<Screen>
			<Text style={styles.eyebrow}>IMAGE STUDIO</Text>
			<Text style={styles.title}>Picture something new.</Text>
			<ModelPicker value={model} onChange={setModel} output="image" />
			<Field
				label="Image prompt"
				value={prompt}
				onChangeText={setPrompt}
				multiline
				style={{ minHeight: 110 }}
			/>
			<Field
				label="Aspect ratio"
				value={aspectRatio}
				onChangeText={setAspectRatio}
				placeholder="1:1"
			/>
			<Button
				title="Generate image"
				disabled={!prompt.trim()}
				busy={generate.isPending}
				onPress={() => generate.mutate()}
			/>
			<ErrorNotice
				error={generate.error ?? history.error ?? detail.error ?? remove.error}
			/>
			{generate.isPending && (
				<Text style={styles.muted}>
					Creating your image. This may take a moment.
				</Text>
			)}
			{selectedId && detail.isPending && <Loading />}
			{displayed.map((image, index) => (
				<Image
					key={`${selectedId ?? "new"}-${index}`}
					accessibilityLabel={detail.data?.item.prompt ?? prompt}
					source={{ uri: `data:${image.mediaType};base64,${image.base64}` }}
					style={{ width: "100%", aspectRatio: 1, borderRadius: 18 }}
					resizeMode="contain"
				/>
			))}
			<Text style={styles.heading}>Your image history</Text>
			{history.isPending && <Loading />}
			{history.data?.items.map((item) => (
				<View key={item.id} style={styles.card}>
					<Text style={styles.body}>{item.prompt}</Text>
					<Button
						title={`View ${item.prompt.slice(0, 50)}`}
						secondary
						onPress={() => setSelectedId(item.id)}
					/>
					<Button
						title="Delete image"
						secondary
						onPress={() =>
							Alert.alert("Delete this generation?", item.prompt, [
								{ text: "Cancel", style: "cancel" },
								{
									text: "Delete",
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
