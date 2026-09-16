import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Alert, Switch, Text, View } from "react-native";

import { api, queryClient } from "@/api/client";
import { authorizeConnector } from "@/api/connectors";
import {
	Button,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";

import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

export function Connectors() {
	const list = api.useQuery("get", "/connectors", {});
	const [search, setSearch] = useState("");
	const [shop, setShop] = useState("");
	const [notice, setNotice] = useState("");
	const controller = useRef<AbortController | null>(null);
	useEffect(() => () => controller.current?.abort(), []);
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/connectors"] });
	const connect = useMutation({
		mutationFn: async ({ id }: { id: LoungeConnectorId; name: string }) => {
			controller.current?.abort();
			const operation = new AbortController();
			controller.current = operation;
			try {
				return await authorizeConnector(
					id,
					id === "shopify" ? shop : undefined,
					operation.signal,
				);
			} finally {
				if (controller.current === operation) {
					controller.current = null;
				}
			}
		},
		onMutate: () => setNotice(""),
		onSuccess: async (status, { name }) => {
			setNotice(
				status === "connected"
					? `Connected to ${name}.`
					: "Sign-in cancelled. Your connections are unchanged.",
			);
			await refresh();
		},
	});
	const update = api.useMutation("patch", "/connectors/{connectorId}", {
		onSuccess: refresh,
	});
	const remove = api.useMutation("delete", "/connectors/{connectorId}", {
		onSuccess: refresh,
	});
	const busy = connect.isPending || update.isPending || remove.isPending;
	const entries = list.data?.connectors.filter((entry) =>
		`${entry.name} ${entry.description}`
			.toLowerCase()
			.includes(search.trim().toLowerCase()),
	);
	const clear = () => {
		connect.reset();
		update.reset();
		remove.reset();
		setNotice("");
	};
	return (
		<Screen>
			<Text style={styles.title}>Your connections</Text>
			<Text style={styles.muted}>
				Connect your apps to The Lounge. Connections belong to your account
				across workspaces. You review each tool call before it runs.
			</Text>
			<Field
				label="Search connectors"
				value={search}
				onChangeText={setSearch}
				autoCapitalize="none"
				autoCorrect={false}
			/>
			<ErrorNotice
				error={list.error ?? connect.error ?? update.error ?? remove.error}
			/>
			{!!notice && (
				<Text accessibilityLiveRegion="polite" style={styles.body}>
					{notice}
				</Text>
			)}
			{list.isPending && <Loading />}
			{list.isError && (
				<Button
					title="Reload connectors"
					secondary
					onPress={() => void list.refetch()}
				/>
			)}
			{entries?.map((entry) => (
				<View key={entry.id} style={styles.card}>
					<Text style={styles.heading}>{entry.name}</Text>
					<Text style={styles.muted}>{entry.description}</Text>
					<Text style={styles.eyebrow}>
						{!entry.available
							? "Not configured"
							: entry.connected
								? entry.enabled
									? "Connected"
									: "Paused"
								: "Not connected"}
					</Text>
					{!entry.available && (
						<Text style={styles.muted}>
							This connector is not configured for this Lounge deployment.
						</Text>
					)}
					{entry.connected && (
						<View style={[styles.row, { justifyContent: "space-between" }]}>
							<Text style={styles.body}>Use in conversations</Text>
							<Switch
								accessibilityLabel={`Enable ${entry.name}`}
								value={entry.enabled}
								disabled={busy || !entry.available}
								onValueChange={(enabled) => {
									clear();
									update.mutate({
										params: { path: { connectorId: entry.id } },
										body: { enabled },
									});
								}}
							/>
						</View>
					)}
					{entry.id === "shopify" && entry.available && (
						<Field
							label="Shopify store"
							placeholder="your-store.myshopify.com"
							value={shop}
							onChangeText={setShop}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
					)}
					{entry.available && (
						<Button
							title={`${entry.connected ? "Reconnect" : "Connect"} ${entry.name}`}
							busy={connect.isPending && connect.variables?.id === entry.id}
							disabled={
								busy ||
								(entry.id === "shopify" && !entry.connected && !shop.trim())
							}
							onPress={() => {
								clear();
								connect.mutate({ id: entry.id, name: entry.name });
							}}
						/>
					)}
					{entry.connected && (
						<Button
							title={`Disconnect ${entry.name}`}
							secondary
							disabled={busy}
							onPress={() =>
								Alert.alert(
									`Disconnect ${entry.name}?`,
									"This removes the saved connection and pending sign-ins. Previous tool results stay in your conversations.",
									[
										{ text: "Cancel", style: "cancel" },
										{
											text: "Disconnect",
											style: "destructive",
											onPress: () => {
												clear();
												remove.mutate({
													params: { path: { connectorId: entry.id } },
												});
											},
										},
									],
								)
							}
						/>
					)}
				</View>
			))}
			{entries?.length === 0 && (
				<Text style={styles.muted}>No connectors match your search.</Text>
			)}
		</Screen>
	);
}
