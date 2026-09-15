import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	FlatList,
	Keyboard,
	KeyboardAvoidingView,
	Share,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DEBATE_TURNS, runDebate } from "@/api/debate";
import { ChatSettings } from "@/components/ChatSettings";
import { MessageBubble } from "@/components/MessageBubble";
import { ModelPicker } from "@/components/ModelPicker";
import { Button, ErrorNotice, Field, styles } from "@/components/ui";
import { defaultChatSettings, usePreferences } from "@/lib/preferences";
import { useFollowingList } from "@/lib/use-following-list";

import type { DebateTurn } from "@/api/debate";

export function GroupConversation({ projectId }: { projectId: string }) {
	const insets = useSafeAreaInsets();
	const preferences = usePreferences();
	const [topic, setTopic] = useState("");
	const [candidate, setCandidate] = useState("auto");
	const [models, setModels] = useState<string[]>([]);
	const [turns, setTurns] = useState<DebateTurn[]>([]);
	const controller = useRef<AbortController | null>(null);
	const following = useFollowingList<DebateTurn>(turns.length > 0);
	useEffect(() => () => controller.current?.abort(), []);
	const run = useMutation({
		mutationFn: async () => {
			Keyboard.dismiss();
			const abort = new AbortController();
			controller.current = abort;
			following.startFollowing();
			await runDebate({
				projectId,
				models,
				topic: topic.trim(),
				turns,
				settings: preferences.data?.chat ?? defaultChatSettings,
				signal: abort.signal,
				onTurn: (index, turn) =>
					setTurns((current) => {
						const next = [...current];
						next[index] = turn;
						return next;
					}),
			});
		},
	});
	const share = useMutation({
		mutationFn: async () => {
			await Share.share({
				message: [
					topic,
					...turns.map(
						(turn) =>
							`${turn.model}\n${turn.content || turn.error || "Response stopped."}`,
					),
				].join("\n\n"),
			});
		},
	});
	const complete = turns.length >= DEBATE_TURNS && !run.isPending;
	return (
		<KeyboardAvoidingView
			style={styles.screen}
			behavior="padding"
			keyboardVerticalOffset={insets.top + 44}
		>
			<FlatList
				{...following.listProps}
				data={turns}
				keyExtractor={(_, index) => String(index)}
				contentContainerStyle={{ padding: 22, gap: 18 }}
				keyboardShouldPersistTaps="handled"
				keyboardDismissMode="interactive"
				ListHeaderComponent={
					<View style={{ gap: 14 }}>
						<Text style={styles.title}>Around the table</Text>
						<Text style={styles.muted}>
							Models take turns discussing your topic. Five turns, kept only
							while this screen is open. Share the transcript to keep a copy.
						</Text>
						{!turns.length && !run.isPending ? (
							<>
								<ModelPicker value={candidate} onChange={setCandidate} />
								<Button
									title="Add model to discussion"
									secondary
									disabled={models.length >= 5 || models.includes(candidate)}
									onPress={() => setModels([...models, candidate])}
								/>
								{models.map((model, index) => (
									<View key={model} style={styles.row}>
										<Text style={[styles.body, { flex: 1 }]}>{model}</Text>
										<Button
											title={`Remove model ${index + 1}`}
											secondary
											onPress={() =>
												setModels(models.filter((value) => value !== model))
											}
										/>
									</View>
								))}
								<Field
									label="Discussion topic"
									multiline
									value={topic}
									onChangeText={setTopic}
								/>
								<ChatSettings />
							</>
						) : (
							<Text selectable style={styles.body}>
								{topic}
							</Text>
						)}
					</View>
				}
				renderItem={({ item, index }) => (
					<View style={{ gap: 8 }}>
						<Text style={styles.heading}>
							{index + 1}. {item.model}
						</Text>
						<MessageBubble
							message={{
								id: `turn-${index}`,
								role: "assistant",
								content:
									item.content ||
									(item.interrupted
										? "Response stopped."
										: item.error
											? "Response failed."
											: ""),
								reasoning: item.reasoning,
								attachments: [],
								sourceLinks: item.sources,
								images: null,
								audios: null,
								documents: null,
								sources: null,
								tools: null,
								metadata: null,
								sequence: index,
								createdAt: item.createdAt,
							}}
						/>
					</View>
				)}
			/>
			<View
				style={{
					paddingHorizontal: 22,
					paddingTop: 12,
					paddingBottom: Math.max(insets.bottom, 12),
					gap: 10,
				}}
			>
				<ErrorNotice error={run.error ?? share.error ?? preferences.error} />
				{turns.length > 0 && (
					<Text accessibilityLiveRegion="polite" style={styles.muted}>
						{complete
							? "Discussion complete"
							: run.isPending
								? `Turn ${turns.length} of ${DEBATE_TURNS}`
								: "Discussion paused"}
					</Text>
				)}
				{run.isPending ? (
					<Button
						title="Stop discussion"
						onPress={() => controller.current?.abort()}
					/>
				) : (
					<>
						{!complete && (
							<Button
								title={
									turns.length ? "Continue discussion" : "Start discussion"
								}
								disabled={
									!topic.trim() ||
									models.length < 2 ||
									preferences.isPending ||
									preferences.isError
								}
								onPress={() => run.mutate()}
							/>
						)}
						{turns.length > 0 && (
							<View style={[styles.row, { flexWrap: "wrap" }]}>
								<Button
									title="Share transcript"
									secondary
									busy={share.isPending}
									onPress={() => share.mutate()}
								/>
								<Button
									title="New discussion"
									secondary
									onPress={() => {
										setTurns([]);
										run.reset();
										share.reset();
									}}
								/>
							</View>
						)}
					</>
				)}
			</View>
		</KeyboardAvoidingView>
	);
}
