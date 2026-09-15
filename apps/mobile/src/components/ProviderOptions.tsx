import { FlatList, Text, View } from "react-native";

import { api } from "@/api/client";
import { Button, ErrorNotice, styles } from "@/components/ui";

import type { operations } from "@/lib/api/v1";

export type CatalogModel =
	operations["internal_get_models"]["responses"][200]["content"]["application/json"]["models"][number];

export function ProviderOptions({
	model,
	onChoose,
	onBack,
}: {
	model: CatalogModel;
	onChoose: (id: string) => void;
	onBack: () => void;
}) {
	const providers = api.useQuery(
		"get",
		"/internal/providers",
		{},
		{ staleTime: 300_000 },
	);
	const mappings = [
		...new Map(
			model.mappings
				.filter(
					(mapping) =>
						mapping.status === "active" &&
						(!mapping.deactivatedAt ||
							new Date(mapping.deactivatedAt).getTime() > Date.now()),
				)
				.map((mapping) => [
					`${mapping.providerId}/${model.id}${mapping.region ? `:${mapping.region}` : ""}`,
					mapping,
				]),
		).entries(),
	];
	return (
		<>
			<View style={{ padding: 22, gap: 14 }}>
				<Text style={styles.heading}>{model.name ?? model.id}</Text>
				<Text style={styles.muted}>
					Choose a provider to pin this model. Requests will not fall back to
					another provider.
				</Text>
				<Button title="Back to models" secondary onPress={onBack} />
				<ErrorNotice error={providers.error} />
			</View>
			<FlatList
				data={mappings}
				keyExtractor={([id]) => id}
				contentContainerStyle={{ padding: 22, gap: 12 }}
				ListEmptyComponent={
					<Text style={styles.muted}>
						No active providers are available for this model.
					</Text>
				}
				renderItem={({ item: [id, mapping] }) => {
					const provider = providers.data?.providers.find(
						(item) => item.id === mapping.providerId,
					);
					const name = `${provider?.name ?? mapping.providerId}${mapping.region ? ` · ${mapping.region}` : ""}`;
					const capabilities = [
						mapping.vision && "Images",
						mapping.reasoning && "Reasoning",
						mapping.webSearch && "Web search",
						mapping.tools && "Tools",
					]
						.filter(Boolean)
						.join(" · ");
					return (
						<View style={styles.card}>
							<Button title={`Use ${name}`} onPress={() => onChoose(id)} />
							{!!capabilities && (
								<Text style={styles.muted}>{capabilities}</Text>
							)}
						</View>
					);
				}}
			/>
		</>
	);
}
