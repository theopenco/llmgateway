import { useIsFocused } from "@react-navigation/native";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { AppState, Linking, Modal, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { api } from "@/api/client";
import { mintTranscriptionSession } from "@/api/realtime";
import { ModelPicker } from "@/components/ModelPicker";
import {
	Button,
	colors,
	ErrorNotice,
	IconButton,
	styles,
} from "@/components/ui";
import { createMicrophone } from "@/lib/microphone";
import { playbackTime } from "@/lib/playback-time";
import { connectRealtime } from "@/lib/realtime-socket";
import { supportsRealtimeTranscription } from "@/lib/transcription-model";
import { TranscriptionSession } from "@/lib/transcription-session";

import type { TranscriptionStatus } from "@/lib/transcription-session";

const statusLabels: Record<TranscriptionStatus, string> = {
	idle: "Ready when you are",
	microphone: "Preparing microphone…",
	minting: "Connecting…",
	connecting: "Connecting…",
	configuring: "Getting ready…",
	live: "Listening…",
	ending: "Turning speech into text…",
};

export function DictationSheet({
	projectId,
	onInsert,
	onClose,
}: {
	projectId: string;
	onInsert: (text: string) => void;
	onClose: () => void;
}) {
	const focused = useIsFocused();
	const callbacks = useRef({ onInsert, onClose });
	callbacks.current = { onInsert, onClose };
	const started = useRef(false);
	const dismissed = useRef(false);
	const [selectedModel, setSelectedModel] = useState("");
	const [insertWhenReady, setInsertWhenReady] = useState(false);
	const [settingsError, setSettingsError] = useState<unknown>();
	const models = api.useQuery(
		"get",
		"/internal/models",
		{},
		{ staleTime: 300_000 },
	);
	const choices = (models.data?.models ?? []).flatMap((model) =>
		model.status === "active"
			? model.mappings
					.filter(
						(mapping) =>
							supportsRealtimeTranscription(mapping) &&
							mapping.status === "active" &&
							(!mapping.deactivatedAt ||
								new Date(mapping.deactivatedAt).getTime() > Date.now()),
					)
					.map(
						(mapping) =>
							`${mapping.providerId}/${model.id}${mapping.region ? `:${mapping.region}` : ""}`,
					)
			: [],
	);
	const model = selectedModel || choices[0] || "";
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
	const transcript = state.segments
		.map((segment) => segment.text.trim())
		.filter(Boolean)
		.join(" ");
	const error =
		state.error || state.segments.find((segment) => segment.error)?.error;
	const busy = state.status !== "idle";
	const live = state.status === "live";
	const cancel = () => {
		if (dismissed.current) {
			return;
		}
		dismissed.current = true;
		void session.finish();
		callbacks.current.onClose();
	};
	const insert = () => {
		if (dismissed.current || !transcript) {
			return;
		}
		dismissed.current = true;
		callbacks.current.onInsert(transcript);
		callbacks.current.onClose();
	};
	useEffect(() => {
		if (model && focused && !started.current && !dismissed.current) {
			started.current = true;
			void session.start(model, true);
		}
	}, [model, focused, session]);
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (next) => {
			if (next === "background" && !dismissed.current) {
				dismissed.current = true;
				void session.finish();
				callbacks.current.onClose();
			}
		});
		return () => {
			dismissed.current = true;
			subscription.remove();
			void session.finish();
		};
	}, [session]);
	useEffect(() => {
		if (!focused && !dismissed.current) {
			dismissed.current = true;
			void session.finish();
			callbacks.current.onClose();
		}
	}, [focused, session]);
	useEffect(() => {
		if (insertWhenReady && !busy) {
			setInsertWhenReady(false);
			if (!dismissed.current && transcript && !error) {
				dismissed.current = true;
				callbacks.current.onInsert(transcript);
				callbacks.current.onClose();
			}
		}
	}, [insertWhenReady, busy, transcript, error]);
	const retryModels = () => void models.refetch();
	return (
		<Modal
			visible
			animationType="slide"
			presentationStyle="pageSheet"
			onRequestClose={cancel}
		>
			<SafeAreaView style={styles.screen}>
				<View
					style={[
						styles.row,
						{
							justifyContent: "space-between",
							paddingHorizontal: 20,
							paddingTop: 10,
						},
					]}
				>
					<Text style={[styles.heading, { flex: 1 }]}>Dictate a message</Text>
					<IconButton
						name="close"
						accessibilityLabel="Cancel dictation"
						variant="soft"
						onPress={cancel}
					/>
				</View>
				<ScrollView
					contentContainerStyle={{ flexGrow: 1, padding: 24, gap: 24 }}
				>
					<View
						style={{
							flex: 1,
							justifyContent: "center",
							alignItems: "center",
							gap: 24,
						}}
					>
						<View
							accessible
							accessibilityRole="progressbar"
							accessibilityLabel="Microphone level"
							accessibilityValue={{
								min: 0,
								max: 100,
								now: Math.round(state.level * 100),
							}}
							style={{
								height: 112,
								flexDirection: "row",
								alignItems: "center",
								gap: 7,
							}}
						>
							{[0.3, 0.55, 0.8, 1, 0.8, 0.55, 0.3].map((weight, index) => (
								<View
									key={index}
									style={{
										width: 10,
										borderRadius: 5,
										height: Math.max(12, state.level * weight * 90),
										backgroundColor: live ? colors.text : colors.subtle,
									}}
								/>
							))}
						</View>
						<Text
							style={[styles.title, { textAlign: "center", fontSize: 28 }]}
							accessibilityLiveRegion="polite"
						>
							{models.isPending ? "Getting ready…" : statusLabels[state.status]}
						</Text>
						<Text style={[styles.muted, { textAlign: "center" }]}>
							{live
								? "Speak naturally, then tap Done."
								: "Your words will be added to the message box."}
						</Text>
						{busy && (
							<Text style={styles.muted}>{playbackTime(state.elapsed)}</Text>
						)}
						{!!transcript && (
							<Text selectable style={styles.body}>
								{transcript}
							</Text>
						)}
					</View>
					<ErrorNotice
						error={error ? new Error(error) : (models.error ?? settingsError)}
					/>
					{state.error?.includes("iOS Settings") && (
						<Button
							title="Open microphone settings"
							secondary
							onPress={() => {
								void Linking.openSettings().catch(setSettingsError);
							}}
						/>
					)}
					{!busy && !models.isPending && !model && !models.error && (
						<Text style={styles.muted}>
							No dictation models are available in this workspace.
						</Text>
					)}
					{!busy && model && (
						<ModelPicker
							value={model}
							onChange={setSelectedModel}
							capability="realtimeTranscription"
							label="Dictation model"
						/>
					)}
					{!busy && !transcript && started.current && !error && (
						<Text style={styles.muted}>
							No speech was detected. Try speaking closer to the microphone.
						</Text>
					)}
					{models.error && <Button title="Retry" onPress={retryModels} />}
					{live ? (
						<Button
							title="Done"
							onPress={() => {
								setInsertWhenReady(true);
								session.stop();
							}}
						/>
					) : !busy && model ? (
						<>
							{!!transcript && <Button title="Use text" onPress={insert} />}
							<Button
								title={started.current ? "Try again" : "Start recording"}
								secondary={!!transcript}
								onPress={() => {
									setInsertWhenReady(false);
									setSettingsError(undefined);
									void session.start(model, true);
								}}
							/>
						</>
					) : null}
				</ScrollView>
			</SafeAreaView>
		</Modal>
	);
}
