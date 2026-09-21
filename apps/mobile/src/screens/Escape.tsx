import { useIsFocused } from "@react-navigation/native";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
	ActionSheetIOS,
	Alert,
	AppState,
	FlatList,
	Text,
	View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { saveEscapeRun, takeEscapeTurn } from "@/api/escape";
import { EscapeBoard, EscapeHud } from "@/components/EscapeBoard";
import { ModelPicker } from "@/components/ModelPicker";
import { Button, ErrorNotice, styles } from "@/components/ui";
import { useEscapeModel } from "@/lib/escape-model";
import { EscapeSession } from "@/lib/escape-session";

import {
	ESCAPE_LEVELS,
	getLevel,
	scoreGame,
} from "@llmgateway/shared/sandbox-escape";

import type { EscapeRunBody } from "@/api/escape";

export function Escape({
	projectId,
	organizationId,
	onHistory,
	onLeaderboard,
	onReplay,
}: {
	projectId: string;
	organizationId: string;
	onHistory: () => void;
	onLeaderboard: () => void;
	onReplay: (id: string) => void;
}) {
	const model = useEscapeModel();
	const focused = useIsFocused();
	const turn = useMutation({
		mutationFn: ({
			body,
			signal,
		}: {
			body: Omit<Parameters<typeof takeEscapeTurn>[0], "projectId">;
			signal: AbortSignal;
		}) => takeEscapeTurn({ ...body, projectId }, signal),
		retry: false,
	});
	const save = useMutation({
		mutationFn: (body: EscapeRunBody) =>
			saveEscapeRun({ ...body, organizationId }),
		retry: false,
	});
	const [session] = useState(
		() =>
			new EscapeSession({
				turn: (body, signal) => turn.mutateAsync({ body, signal }),
				save: save.mutateAsync,
			}),
	);
	const run = useSyncExternalStore(session.subscribe, session.getSnapshot);
	useEffect(() => () => session.dispose(), [session]);
	useEffect(() => {
		if (!focused) {
			session.pause();
		}
	}, [focused, session]);
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") {
				session.pause();
			}
		});
		return () => subscription.remove();
	}, [session]);
	const level = getLevel(run.game.levelId);
	const selected = model.data ?? "openai/gpt-5-mini";
	const finished = run.game.outcome !== "running";
	const unavailable = model.isPending || model.isError || model.save.isPending;
	const reset = (levelId = level.id) => {
		if (!run.game.step && !run.thinking) {
			session.reset(levelId);
			return;
		}
		Alert.alert(
			"Start a new run?",
			run.saveError
				? "This finished run has not been saved. Retry saving before starting over to keep it."
				: "This clears the board and turn trace. Saved runs stay in your history.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Start new run",
					style: "destructive",
					onPress: () => session.reset(levelId),
				},
			],
		);
	};
	return (
		<SafeAreaView style={styles.screen} edges={["bottom"]}>
			<FlatList
				data={[...run.trace].reverse()}
				keyExtractor={(entry) => String(entry.id)}
				contentContainerStyle={styles.content}
				ListHeaderComponent={
					<View style={{ gap: 14, paddingBottom: 16 }}>
						<Text style={styles.eyebrow}>SANDBOX ESCAPE</Text>
						<Text style={styles.heading}>{level.name}</Text>
						<Text style={styles.muted}>
							{level.tagline} The model collects every key, avoids daemons, and
							finds the exit. Each turn uses your Lounge allowance.
						</Text>
						<View style={[styles.row, { flexWrap: "wrap" }]}>
							<Button
								title="Level"
								secondary
								onPress={() =>
									ActionSheetIOS.showActionSheetWithOptions(
										{
											title: "Choose level",
											options: [
												"Cancel",
												...ESCAPE_LEVELS.map(
													(item) => `${item.id}. ${item.name}`,
												),
											],
											cancelButtonIndex: 0,
										},
										(index) => {
											if (index > 0) {
												reset(ESCAPE_LEVELS[index - 1].id);
											}
										},
									)
								}
							/>
							<Button title="Saved runs" secondary onPress={onHistory} />
							<Button title="Rankings" secondary onPress={onLeaderboard} />
						</View>
						<ModelPicker
							value={run.model ?? selected}
							disabled={!!run.model || unavailable}
							onChange={(value) => model.save.mutate(value)}
						/>
						{run.model && (
							<Text style={styles.muted}>
								Start a new run to change models.
							</Text>
						)}
						<EscapeBoard state={run.game} />
						<EscapeHud state={run.game} />
						<Text style={styles.muted}>
							{run.usage.promptTokens} input · {run.usage.completionTokens}{" "}
							output tokens · ${run.usage.cost.toFixed(4)}
						</Text>
						<View style={[styles.row, { flexWrap: "wrap" }]}>
							{!finished && (
								<>
									<Button
										title={
											run.running
												? "Pause run"
												: run.game.step
													? "Resume run"
													: "Start run"
										}
										disabled={!run.running && unavailable}
										onPress={() =>
											run.running ? session.pause() : session.start(selected)
										}
									/>
									<Button
										title="One step"
										secondary
										disabled={run.running || run.thinking || unavailable}
										onPress={() => void session.step(selected)}
									/>
								</>
							)}
							<Button
								title="New run"
								secondary
								disabled={run.saving}
								onPress={() => reset()}
							/>
						</View>
						{run.thinking && (
							<Text accessibilityLiveRegion="polite" style={styles.muted}>
								{run.running
									? "Model is thinking…"
									: "Finishing the current turn…"}
							</Text>
						)}
						<ErrorNotice error={run.error ?? model.error ?? model.save.error} />
						{model.isError && (
							<Button
								title="Reload model preference"
								onPress={() => void model.refetch()}
							/>
						)}
						{finished && (
							<View style={styles.card}>
								<Text style={styles.heading}>
									{run.game.outcome === "escaped"
										? "Escaped"
										: run.game.outcome === "terminated"
											? "Terminated"
											: "Compute budget exhausted"}
								</Text>
								<Text style={styles.body}>
									Score {scoreGame(run.game).score}
								</Text>
								{run.saving && <Text style={styles.muted}>Saving run…</Text>}
								<ErrorNotice error={run.saveError} />
								{run.saveError && (
									<Button
										title="Retry saving run"
										busy={run.saving}
										onPress={() => void session.save()}
									/>
								)}
								{run.saved && (
									<Button
										title="Replay and share"
										onPress={() => onReplay(run.saved!.id)}
									/>
								)}
							</View>
						)}
						<Text style={styles.heading}>Turn trace</Text>
					</View>
				}
				ListEmptyComponent={
					<Text style={styles.muted}>
						The model’s moves and reasoning will appear here.
					</Text>
				}
				renderItem={({ item }) => (
					<View style={[styles.card, { marginBottom: 12 }]}>
						<Text style={styles.heading}>
							Turn {item.id} · {item.move}
						</Text>
						<Text style={styles.body}>
							{item.thought ||
								(item.understood
									? "No thought returned."
									: "Unrecognized reply; waited for one turn.")}
						</Text>
						<Text style={styles.body}>{item.state.lastEvent}</Text>
						<Text style={styles.muted}>
							{item.usedModel ?? run.model} · ${item.usage.cost.toFixed(4)} ·{" "}
							{(item.usage.durationMs / 1000).toFixed(1)}s
						</Text>
					</View>
				)}
			/>
		</SafeAreaView>
	);
}
