import Clipboard from "@react-native-clipboard/clipboard";
import { useIsFocused } from "@react-navigation/native";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Alert, Linking, Text, View } from "react-native";

import { api } from "@/api/client";
import { findVoiceModel, voiceSelection } from "@/api/realtime";
import { AudioResult } from "@/components/AudioResult";
import { Choice } from "@/components/Choice";
import { ModelPicker } from "@/components/ModelPicker";
import {
	Button,
	colors,
	ErrorNotice,
	Field,
	Loading,
	Screen,
	styles,
} from "@/components/ui";
import { useVoiceCalls } from "@/components/VoiceCallsProvider";
import { playbackTime } from "@/lib/playback-time";

import type { TranscriptionStatus } from "@/lib/transcription-session";

const labels: Record<TranscriptionStatus, string> = {
	idle: "Ready to call",
	microphone: "Preparing microphone…",
	minting: "Creating session…",
	connecting: "Connecting…",
	configuring: "Preparing voice…",
	live: "Listening",
	ending: "Ending call…",
};
function Meter({ label, level }: { label: string; level: number }) {
	return (
		<View style={{ gap: 6 }}>
			<Text style={styles.muted}>{label}</Text>
			<View
				accessible
				accessibilityLabel={`${label} level`}
				accessibilityRole="progressbar"
				accessibilityValue={{ min: 0, max: 100, now: Math.round(level * 100) }}
				style={{ height: 8, borderRadius: 4, backgroundColor: colors.border }}
			>
				<View
					style={{
						height: 8,
						borderRadius: 4,
						backgroundColor: colors.accent,
						width: `${level * 100}%`,
					}}
				/>
			</View>
		</View>
	);
}

export function VoiceCalls({ organizationId }: { organizationId: string }) {
	const calls = useVoiceCalls();
	const { session, state } = calls;
	const queries = useQueryClient();
	const focused = useIsFocused();
	const [model, setModel] = useState("");
	const [voice, setVoice] = useState("");
	const [selectedId, setSelectedId] = useState<string>();
	const [search, setSearch] = useState("");
	const [error, setError] = useState<unknown>();
	const [copied, setCopied] = useState<string>();
	const [replay, setReplay] = useState<number>();
	const models = api.useQuery(
		"get",
		"/internal/models",
		{},
		{ staleTime: 300_000 },
	);
	const catalog = models.data?.models ?? [];
	const resolved = findVoiceModel(model, catalog);
	const voices = resolved?.mapping.supportedVoices ?? [];
	const effectiveVoice = voices.includes(voice) ? voice : (voices[0] ?? "");
	const busy = state.status !== "idle";
	const locked = busy || Boolean(calls.pending) || calls.saving;
	const viewedId = selectedId ?? calls.savedId;
	const detail = api.useQuery(
		"get",
		"/playground/realtime-history/{id}",
		{ params: { path: { id: viewedId ?? "" } } },
		{ enabled: Boolean(viewedId) && !busy },
	);
	const history = api.useQuery("get", "/playground/realtime-history", {
		params: { query: { organizationId } },
	});
	const saved = !busy && !calls.pending ? detail.data?.item : undefined;
	const displayState = calls.pending?.state ?? state;
	const transcript = saved?.transcript ?? displayState.transcript;
	const usage = saved?.usage ?? displayState.usage;
	const savedModel = saved && findVoiceModel(saved.model, catalog);
	const text = transcript
		.map(
			(entry) =>
				`${entry.role === "user" ? "You" : "Assistant"}: ${entry.text}`,
		)
		.join("\n\n");
	const refresh = () => {
		void queries.invalidateQueries({
			queryKey: ["get", "/playground/realtime-history"],
		});
		void queries.invalidateQueries({
			queryKey: ["get", "/playground/realtime-history/{id}"],
		});
	};
	const remove = api.useMutation(
		"delete",
		"/playground/realtime-history/{id}",
		{
			onSuccess: () => {
				setSelectedId(undefined);
				calls.reset();
				refresh();
			},
		},
	);
	const rename = api.useMutation("patch", "/playground/realtime-history/{id}", {
		onSuccess: refresh,
	});
	useEffect(() => {
		if (!focused) {
			void session.end();
		}
	}, [focused, session]);
	useEffect(
		() => () => {
			void session.end();
		},
		[session],
	);
	return (
		<Screen>
			<Text style={styles.title}>A conversation, out loud.</Text>
			<Text style={styles.muted}>
				Speak naturally. Interrupt whenever you like. Calls save to your
				workspace with transcripts and assistant audio.
			</Text>
			<ModelPicker
				value={model}
				capability="realtime"
				disabled={locked}
				onChange={(value) => {
					setModel(value);
					setVoice("");
				}}
			/>
			{voices.length > 0 && (
				<Choice
					label="Voice"
					value={effectiveVoice}
					options={voices}
					disabled={locked}
					onChange={setVoice}
				/>
			)}
			<ErrorNotice
				error={state.error ? new Error(state.error) : (error ?? models.error)}
			/>
			{state.error?.includes("iOS Settings") && (
				<Button
					title="Open microphone settings"
					secondary
					onPress={() => {
						void Linking.openSettings().catch((cause: unknown) =>
							setError(cause),
						);
					}}
				/>
			)}
			<View style={styles.card}>
				<Text style={styles.heading} accessibilityLiveRegion="polite">
					{state.status === "live"
						? state.muted
							? "Microphone muted"
							: state.userSpeaking
								? "You're speaking"
								: state.assistantSpeaking
									? "Assistant speaking"
									: "Listening"
						: labels[state.status]}
				</Text>
				<Text style={styles.muted}>
					{playbackTime(
						busy
							? state.elapsed
							: (saved?.durationSeconds ?? displayState.elapsed),
					)}
				</Text>
				{busy && (
					<>
						<Meter label="Microphone" level={state.inputLevel} />
						<Meter label="Assistant" level={state.outputLevel} />
					</>
				)}
				{busy ? (
					<Button
						title={
							state.status === "ending"
								? "Ending call…"
								: state.status === "live"
									? "End call"
									: "Cancel connection"
						}
						disabled={state.status === "ending"}
						onPress={() => {
							void session.end();
						}}
					/>
				) : (
					<Button
						title="Start voice call"
						disabled={locked || !resolved || !focused}
						onPress={() => {
							try {
								const selection = voiceSelection(
									model,
									effectiveVoice || null,
									catalog,
								);
								setSelectedId(undefined);
								setReplay(undefined);
								setError(undefined);
								calls.start(selection);
							} catch (cause) {
								setError(cause);
							}
						}}
					/>
				)}
				{state.status === "live" && (
					<Button
						title={state.muted ? "Unmute microphone" : "Mute microphone"}
						secondary
						onPress={() => session.setMuted(!state.muted)}
					/>
				)}
			</View>
			{calls.saving && <Text style={styles.muted}>Saving call…</Text>}
			<ErrorNotice error={calls.saveError} />
			{calls.pending && !calls.saving && (
				<>
					<Text style={styles.muted}>
						Your call is kept here until it saves. Retry before starting another
						call.
					</Text>
					<Button title="Retry saving call" onPress={calls.retrySave} />
				</>
			)}
			{saved && (
				<View style={styles.card}>
					<Text style={styles.heading}>{saved.title}</Text>
					<Text style={styles.muted}>
						{saved.model}
						{saved.voice ? ` · ${saved.voice}` : ""}
					</Text>
					{savedModel?.mapping.providerId === "google-ai-studio" ? (
						<Text style={styles.muted}>
							This model supports new calls. Saved calls remain available to
							read and replay.
						</Text>
					) : (
						<Button
							title="Continue this call"
							secondary
							disabled={locked || !savedModel || !focused}
							onPress={() => {
								try {
									const selection = voiceSelection(
										saved.model,
										saved.voice,
										catalog,
									);
									setSelectedId(undefined);
									setReplay(undefined);
									setError(undefined);
									calls.start(selection, saved);
								} catch (cause) {
									setError(cause);
								}
							}}
						/>
					)}
				</View>
			)}
			{!busy && viewedId && detail.isPending && <Loading />}
			<ErrorNotice error={detail.error} />
			{transcript.map((entry, index) => (
				<View key={`${viewedId ?? "live"}-${index}`} style={styles.card}>
					<Text style={styles.muted}>
						{entry.role === "user" ? "You" : "Assistant"}
						{entry.status === "interrupted"
							? " · Interrupted"
							: entry.status === "partial"
								? busy
									? " · Speaking…"
									: " · Partial"
								: ""}
					</Text>
					<Text style={styles.body} selectable>
						{entry.text ||
							(entry.role === "assistant"
								? "Audio response"
								: busy
									? "Transcribing…"
									: "Transcript unavailable")}
					</Text>
					{!busy &&
						entry.audio &&
						(replay === index ? (
							<AudioResult
								result={{
									modelId: saved?.model ?? displayState.selection?.model ?? "",
									modelName: `Assistant · turn ${index + 1}`,
									audio: entry.audio,
								}}
							/>
						) : (
							<Button
								title={`Replay assistant turn ${index + 1}`}
								secondary
								onPress={() => setReplay(index)}
							/>
						))}
				</View>
			))}
			{displayState.audioLimited && (
				<Text style={styles.muted}>
					This call reached the audio storage limit. The transcript continues;
					earlier saved clips are kept.
				</Text>
			)}
			{!!transcript.length && (
				<Button
					title={copied === text ? "Transcript copied" : "Copy call transcript"}
					secondary
					onPress={() => {
						Clipboard.setString(text);
						setCopied(text);
					}}
				/>
			)}
			{!!usage?.responses && (
				<Text style={styles.muted}>
					{usage.responses} responses · {usage.inputTokens} input tokens ·{" "}
					{usage.outputTokens} output tokens
				</Text>
			)}
			<Text style={styles.heading}>Call history</Text>
			<Field label="Search calls" value={search} onChangeText={setSearch} />
			<ErrorNotice error={history.error ?? rename.error ?? remove.error} />
			{history.isPending && <Loading />}
			{history.data?.items
				.filter((item) =>
					item.title.toLowerCase().includes(search.toLowerCase()),
				)
				.map((item) => (
					<View key={item.id} style={styles.card}>
						<Button
							title={item.title}
							accessibilityLabel={`Open saved call: ${item.title}`}
							secondary
							disabled={locked}
							onPress={() => {
								setSelectedId(item.id);
								setReplay(undefined);
							}}
						/>
						<Text style={styles.muted}>
							{new Date(item.createdAt).toLocaleString()} ·{" "}
							{playbackTime(item.durationSeconds)} · {item.turnCount} turns
						</Text>
						<Button
							title="Rename call"
							secondary
							disabled={locked || rename.isPending}
							onPress={() =>
								Alert.prompt(
									"Rename call",
									undefined,
									(value) => {
										if (value.trim()) {
											rename.mutate({
												params: { path: { id: item.id } },
												body: { title: value.trim() },
											});
										}
									},
									"plain-text",
									item.title,
								)
							}
						/>
						<Button
							title="Delete call"
							secondary
							disabled={locked || remove.isPending}
							onPress={() =>
								Alert.alert(
									"Delete this call?",
									"The transcript and saved assistant audio will be removed.",
									[
										{ text: "Cancel", style: "cancel" },
										{
											text: "Delete saved call",
											style: "destructive",
											onPress: () =>
												remove.mutate({ params: { path: { id: item.id } } }),
										},
									],
								)
							}
						/>
					</View>
				))}
		</Screen>
	);
}
