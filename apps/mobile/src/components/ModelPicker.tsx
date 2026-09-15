import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, queryClient } from "@/api/client";
import { ProviderOptions } from "@/components/ProviderOptions";

import { Button, ErrorNotice, Field, Loading, styles } from "./ui";

import type { CatalogModel } from "@/components/ProviderOptions";

export function ModelPicker({
	value,
	onChange,
	output = "text",
}: {
	value: string;
	onChange: (model: string) => void;
	output?: "text" | "image" | "video" | "audio";
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [providerModel, setProviderModel] = useState<CatalogModel | null>(null);
	const choose = (id: string) => {
		onChange(id);
		setOpen(false);
		setProviderModel(null);
	};
	const models = api.useQuery(
		"get",
		"/internal/models",
		{},
		{ enabled: open, staleTime: 300_000 },
	);
	const favorites = api.useQuery("get", "/user/favorites", {});
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/user/favorites"] });
	const add = api.useMutation("post", "/user/favorites", {
		onSuccess: refresh,
	});
	const remove = api.useMutation("delete", "/user/favorites", {
		onSuccess: refresh,
	});
	const choices = (models.data?.models ?? [])
		.filter(
			(model) =>
				model.status === "active" &&
				(model.output ? model.output.includes(output) : output === "text") &&
				`${model.name} ${model.id}`
					.toLowerCase()
					.includes(search.toLowerCase()),
		)
		.sort(
			(a, b) =>
				Number(favorites.data?.favorites.includes(b.id)) -
				Number(favorites.data?.favorites.includes(a.id)),
		);
	return (
		<>
			<Button
				title={`Model: ${value === "auto" ? "Auto" : value}`}
				secondary
				onPress={() => {
					setProviderModel(null);
					setOpen(true);
				}}
			/>
			<Modal
				visible={open}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setOpen(false)}
			>
				<SafeAreaView style={styles.screen}>
					{providerModel ? (
						<ProviderOptions
							model={providerModel}
							onChoose={choose}
							onBack={() => setProviderModel(null)}
						/>
					) : (
						<>
							<View style={{ padding: 22, gap: 14 }}>
								<Text style={styles.title}>Choose your model</Text>
								<Field
									label="Search models"
									value={search}
									onChangeText={setSearch}
								/>
								<Button
									title="Auto route"
									secondary
									onPress={() => choose("auto")}
								/>
								<ErrorNotice
									error={
										models.error ?? favorites.error ?? add.error ?? remove.error
									}
								/>
								<Button title="Done" onPress={() => setOpen(false)} />
							</View>
							{models.isPending && <Loading />}
							<FlatList
								data={choices}
								keyExtractor={(model) => model.id}
								contentContainerStyle={{ padding: 22, gap: 12 }}
								renderItem={({ item }) => (
									<View style={styles.card}>
										<View style={styles.row}>
											<Pressable
												style={{ flex: 1 }}
												role="button"
												aria-label={`Choose ${item.name ?? item.id}`}
												onPress={() => choose(item.id)}
											>
												<Text style={styles.body}>{item.name ?? item.id}</Text>
												<Text style={styles.muted}>{item.id}</Text>
											</Pressable>
											<Button
												title={
													favorites.data?.favorites.includes(item.id)
														? "Unfavorite"
														: "Favorite"
												}
												accessibilityLabel={`${favorites.data?.favorites.includes(item.id) ? "Unfavorite" : "Favorite"} ${item.name ?? item.id}`}
												busy={add.isPending || remove.isPending}
												secondary
												onPress={() =>
													favorites.data?.favorites.includes(item.id)
														? remove.mutate({
																params: { query: { modelId: item.id } },
															})
														: add.mutate({ body: { modelId: item.id } })
												}
											/>
										</View>
										<Button
											title={`Providers for ${item.name ?? item.id}`}
											secondary
											onPress={() => setProviderModel(item)}
										/>
									</View>
								)}
							/>
						</>
					)}
				</SafeAreaView>
			</Modal>
		</>
	);
}
