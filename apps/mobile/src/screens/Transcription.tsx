import Clipboard from "@react-native-clipboard/clipboard";
import { useIsFocused } from "@react-navigation/native";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { AppState, Linking, Switch, Text, View } from "react-native";

import { api } from "@/api/client";
import { mintTranscriptionSession } from "@/api/realtime";
import { ModelPicker } from "@/components/ModelPicker";
import { Button, colors, ErrorNotice, Screen, styles } from "@/components/ui";
import { createMicrophone } from "@/lib/microphone";
import { playbackTime } from "@/lib/playback-time";
import { connectRealtime } from "@/lib/realtime-socket";
import { TranscriptionSession } from "@/lib/transcription-session";

import type { TranscriptionStatus } from "@/lib/transcription-session";

const statusLabels: Record<TranscriptionStatus, string> = {
	idle: "Ready to transcribe",
	microphone: "Preparing microphone…",
	minting: "Creating session…",
	connecting: "Connecting…",
	configuring: "Preparing transcription…",
	live: "Listening",
	ending: "Finishing transcript…",
};

export function Transcription({ projectId }: { projectId: string }) {
	const [model, setModel] = useState("");
	const [automatic, setAutomatic] = useState(true);
	const [copied, setCopied] = useState<string>();
	const [settingsError, setSettingsError] = useState<Error>();
	const focused = useIsFocused();
	const models = api.useQuery(
		"get",
		"/internal/models",
		{},
		{ staleTime: 300_000 },
	);
	const session = useMemo(
		() =>
			new TranscriptionSession({
				microphone: createMicrophone,
				mint: (selection, signal) =>
					mintTranscriptionSession(projectId, selection, signal),
				connect: connectRealtime,
			}),
		[projectId],
	);
	const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
	const busy = state.status !== "idle";
	const live = state.status === "live";
	const mapping = models.data?.models
		.flatMap((entry) =>
			entry.mappings.map((provider) => ({
				...provider,
				selection: `${provider.providerId}/${entry.id}${provider.region ? `:${provider.region}` : ""}`,
			})),
		)
		.find((entry) => entry.selection === model);
	const supportsAutomatic =
		mapping?.realtimeTranscriptionTurnDetection === true;
	const manual = !automatic || !supportsAutomatic;
	const transcript = state.segments
		.map((segment) => segment.text)
		.filter(Boolean)
		.join("\n\n");
	useEffect(() => {
		const listener = AppState.addEventListener("change", (next) => {
			if (next === "background") {
				session.stop();
			}
		});
		return () => {
			listener.remove();
			void session.finish();
		};
	}, [session]);
	useEffect(() => {
		if (!focused) {
			session.stop();
		}
	}, [focused, session]);
	return (
		<Screen>
			<Text style={styles.title}>Turn speech into text.</Text>
			<Text style={styles.muted}>
				Speak naturally and watch the transcript appear. Copy the text before
				leaving this screen; transcription sessions are not saved to history.
			</Text>
			<ModelPicker
				value={model}
				onChange={setModel}
				capability="realtimeTranscription"
				disabled={busy}
			/>
			<View style={styles.card}>
				<View style={styles.row}>
					<Text style={[styles.body, { flex: 1 }]}>
						Automatic speech detection
					</Text>
					<Switch
						trackColor={{ false: colors.subtle, true: colors.accent }}
						testID="transcription-automatic"
						accessibilityLabel="Automatic speech detection"
						value={!manual}
						disabled={busy || !supportsAutomatic}
						onValueChange={setAutomatic}
					/>
				</View>
				<Text style={styles.muted}>
					{manual
						? "Tap Transcribe turn when you finish speaking. Stop also submits your last turn."
						: "Each pause completes a turn automatically."}
				</Text>
				{!!model && !supportsAutomatic && (
					<Text style={styles.muted}>This model uses manual turns.</Text>
				)}
			</View>
			<ErrorNotice
				error={
					state.error ? new Error(state.error) : (models.error ?? settingsError)
				}
			/>
			{state.error?.includes("iOS Settings") && (
				<Button
					title="Open microphone settings"
					secondary
					onPress={() => {
						void Linking.openSettings().catch((error: unknown) =>
							setSettingsError(
								error instanceof Error
									? error
									: new Error("Could not open Settings."),
							),
						);
					}}
				/>
			)}
			<View style={styles.card}>
				<Text style={styles.heading} accessibilityLiveRegion="polite">
					{live && state.muted
						? "Microphone muted"
						: live && state.speaking
							? "Speech detected"
							: statusLabels[state.status]}
				</Text>
				<Text style={styles.muted}>{playbackTime(state.elapsed)}</Text>
				<View
					accessible
					accessibilityLabel="Microphone level"
					accessibilityRole="progressbar"
					accessibilityValue={{
						min: 0,
						max: 100,
						now: Math.round(state.level * 100),
					}}
					style={{ height: 8, backgroundColor: colors.border, borderRadius: 4 }}
				>
					<View
						style={{
							height: 8,
							borderRadius: 4,
							backgroundColor: colors.accent,
							width: `${state.level * 100}%`,
						}}
					/>
				</View>
				{!busy ? (
					<Button
						title="Start transcription"
						disabled={!model || !focused || !mapping?.realtimeTranscription}
						onPress={() => {
							setCopied(undefined);
							void session.start(model, manual);
						}}
					/>
				) : (
					<Button
						title={
							state.status === "ending"
								? "Stop now"
								: live
									? "Stop transcription"
									: "Cancel connection"
						}
						onPress={() => {
							if (state.status === "ending") {
								void session.finish();
							} else {
								session.stop();
							}
						}}
					/>
				)}
				{live && (
					<Button
						title={state.muted ? "Unmute microphone" : "Mute microphone"}
						secondary
						onPress={() => session.setMuted(!state.muted)}
					/>
				)}
				{live && manual && (
					<Button
						title="Transcribe turn"
						secondary
						disabled={!state.uncommitted}
						onPress={() => session.commit()}
					/>
				)}
			</View>
			{state.segments.map((segment, index) => (
				<View key={segment.id} style={styles.card}>
					<Text style={styles.muted}>
						Turn {index + 1}
						{segment.status === "partial"
							? busy
								? " · Transcribing…"
								: " · Partial"
							: segment.status === "failed"
								? " · Failed"
								: ""}
					</Text>
					<Text selectable style={styles.body}>
						{segment.text || "Waiting for text…"}
					</Text>
					<ErrorNotice
						error={segment.error ? new Error(segment.error) : undefined}
					/>
				</View>
			))}
			{!!transcript && (
				<Button
					title={
						copied === transcript ? "Transcript copied" : "Copy transcript"
					}
					secondary
					onPress={() => {
						Clipboard.setString(transcript);
						setCopied(transcript);
					}}
				/>
			)}
			{!!state.segments.length && (
				<Button
					title="Clear transcript"
					secondary
					disabled={busy}
					onPress={() => {
						session.reset();
						setCopied(undefined);
					}}
				/>
			)}
			{state.usage.segments > 0 && (
				<Text style={styles.muted}>
					{state.usage.segments} completed turns ·{" "}
					{state.usage.seconds > 0
						? `${state.usage.seconds.toFixed(1)} seconds transcribed`
						: `${state.usage.inputTokens} input tokens · ${state.usage.outputTokens} output tokens`}
				</Text>
			)}
		</Screen>
	);
}
