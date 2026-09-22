import { useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api, queryClient } from "@/api/client";
import { ProviderOptions } from "@/components/ProviderOptions";
import { supportsRealtimeTranscription } from "@/lib/transcription-model";

import {
	Button,
	colors,
	ErrorNotice,
	Field,
	Icon,
	IconButton,
	Loading,
	styles,
} from "./ui";

import type { CatalogModel } from "@/components/ProviderOptions";

export function ModelPicker({
	value,
	onChange,
	output = "text",
	label = "Model",
	disabled = false,
	compact = false,
	capability,
}: {
	value: string;
	onChange: (model: string) => void;
	output?: "text" | "image" | "video" | "audio";
	label?: string;
	disabled?: boolean;
	compact?: boolean;
	capability?: "realtime" | "realtimeTranscription";
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
		.map((model) =>
			output === "audio" || capability
				? {
						...model,
						mappings: model.mappings.filter(
							(mapping) =>
								(capability === "realtimeTranscription"
									? supportsRealtimeTranscription(mapping)
									: capability
										? mapping[capability]
										: mapping.speechGenerations) &&
								mapping.status === "active" &&
								(!mapping.deactivatedAt ||
									new Date(mapping.deactivatedAt).getTime() > Date.now()),
						),
					}
				: model,
		)
		.filter(
			(model) =>
				model.status === "active" &&
				(!(output === "audio" || capability) || model.mappings.length > 0) &&
				(capability ||
					(model.output ? model.output.includes(output) : output === "text")) &&
				`${model.name} ${model.id}`
					.toLowerCase()
					.includes(search.toLowerCase()),
		)
		.sort(
			(a, b) =>
				Number(favorites.data?.favorites.includes(b.id)) -
				Number(favorites.data?.favorites.includes(a.id)),
		);
	const selectedName =
		value === "auto"
			? "Auto"
			: (models.data?.models.find((model) => model.id === value)?.name ??
				(value.split("/").pop() || "Choose"));
	return (
		<>
			<Pressable
				role="button"
				aria-label={`${label}: ${value === "auto" ? "Auto" : value || "Choose"}`}
				aria-disabled={disabled}
				aria-expanded={open}
				disabled={disabled}
				style={({ pressed }) => [
					{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: "center",
						gap: 7,
						minHeight: 44,
						paddingHorizontal: compact ? 8 : 16,
						paddingVertical: 8,
						borderRadius: 22,
						backgroundColor: compact ? "transparent" : colors.surface,
						opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
					},
				]}
				onPress={() => {
					setProviderModel(null);
					setOpen(true);
				}}
			>
				<Text
					numberOfLines={1}
					style={{
						color: colors.text,
						fontSize: compact ? 17 : 15,
						fontWeight: "600",
						flexShrink: 1,
					}}
				>
					{compact ? selectedName : `${label}: ${selectedName}`}
				</Text>
				<Icon name="chevron-down" size={14} color={colors.muted} />
			</Pressable>
			<Modal
				visible={open}
				animationType="slide"
				presentationStyle="pageSheet"
				onRequestClose={() => setOpen(false)}
			>
				<SafeAreaView style={styles.screen} edges={["bottom"]}>
					{providerModel ? (
						<ProviderOptions
							model={providerModel}
							onChoose={choose}
							onBack={() => setProviderModel(null)}
						/>
					) : (
						<FlatList
							keyboardShouldPersistTaps="handled"
							keyboardDismissMode="interactive"
							automaticallyAdjustKeyboardInsets
							ListHeaderComponent={
								<>
									<View style={{ gap: 14, paddingBottom: 14 }}>
										<View
											style={[styles.row, { justifyContent: "space-between" }]}
										>
											<Text style={[styles.heading, { flex: 1 }]}>
												Choose your model
											</Text>
											<IconButton
												name="close"
												accessibilityLabel="Done"
												variant="soft"
												size={36}
												onPress={() => setOpen(false)}
											/>
										</View>
										<Field
											label="Search models"
											value={search}
											onChangeText={setSearch}
											placeholder="Search by name"
											autoCapitalize="none"
											autoCorrect={false}
										/>
										{!capability &&
											(output === "text" || output === "image") && (
												<Pressable
													role="button"
													aria-label="Auto route"
													aria-selected={value === "auto"}
													style={[
														styles.row,
														{
															backgroundColor: colors.surface,
															padding: 16,
															borderRadius: 18,
														},
													]}
													onPress={() => choose("auto")}
												>
													<Icon name="sparkles" />
													<View style={{ flex: 1, gap: 3 }}>
														<Text style={[styles.body, { fontWeight: "600" }]}>
															Auto
														</Text>
														<Text style={styles.muted}>
															Let the gateway choose a model
														</Text>
													</View>
													{value === "auto" && <Icon name="check" size={18} />}
												</Pressable>
											)}
										<ErrorNotice
											error={
												models.error ??
												favorites.error ??
												add.error ??
												remove.error
											}
										/>
									</View>
									{models.isPending && <Loading />}
								</>
							}
							data={choices}
							ListEmptyComponent={
								!models.isPending && !models.error ? (
									<Text
										style={[
											styles.muted,
											{ paddingVertical: 20, textAlign: "center" },
										]}
									>
										No models match your search.
									</Text>
								) : undefined
							}
							keyExtractor={(model) => model.id}
							contentContainerStyle={{ padding: 20 }}
							renderItem={({ item }) => (
								<View
									style={{
										paddingVertical: 14,
										gap: 4,
										borderBottomWidth: 1,
										borderBottomColor: colors.subtle,
									}}
								>
									<View style={[styles.row, { flexWrap: "wrap" }]}>
										<Pressable
											style={{ flexGrow: 1, flexBasis: 180 }}
											role="button"
											aria-label={`Choose ${item.name ?? item.id}`}
											aria-selected={value === item.id}
											onPress={() =>
												choose(
													capability
														? `${item.mappings[0].providerId}/${item.id}${item.mappings[0].region ? `:${item.mappings[0].region}` : ""}`
														: item.id,
												)
											}
										>
											<Text style={styles.body}>{item.name ?? item.id}</Text>
											<Text style={styles.muted}>{item.id}</Text>
										</Pressable>
										<IconButton
											name="star"
											accessibilityLabel={`${favorites.data?.favorites.includes(item.id) ? "Unfavorite" : "Favorite"} ${item.name ?? item.id}`}
											busy={add.isPending || remove.isPending}
											variant={
												favorites.data?.favorites.includes(item.id)
													? "filled"
													: "plain"
											}
											iconSize={18}
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
										title="Choose provider"
										accessibilityLabel={`Providers for ${item.name ?? item.id}`}
										quiet
										onPress={() => setProviderModel(item)}
									/>
								</View>
							)}
						/>
					)}
				</SafeAreaView>
			</Modal>
		</>
	);
}
