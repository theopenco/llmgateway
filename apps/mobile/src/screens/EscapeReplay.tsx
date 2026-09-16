import Clipboard from "@react-native-clipboard/clipboard";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppState, Share, Text, View } from "react-native";

import { client } from "@/api/client";
import { escapeReplayFrames, escapeRunUrl } from "@/api/escape";
import { EscapeBoard, EscapeHud } from "@/components/EscapeBoard";
import { Button, ErrorNotice, Loading, Screen, styles } from "@/components/ui";

import type { GameState } from "@llmgateway/shared/sandbox-escape";

function Playback({ frames }: { frames: GameState[] }) {
	const [cursor, setCursor] = useState(0);
	const [playing, setPlaying] = useState(false);
	const focused = useIsFocused();
	const last = frames.length - 1;
	useEffect(() => {
		if (!focused) {
			setPlaying(false);
		}
	}, [focused]);
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") {
				setPlaying(false);
			}
		});
		return () => subscription.remove();
	}, []);
	useEffect(() => {
		if (!playing || cursor >= last || !focused) {
			return;
		}
		const timer = setTimeout(() => setCursor((current) => current + 1), 340);
		return () => clearTimeout(timer);
	}, [playing, cursor, last, focused]);
	const seek = (next: number) => {
		setPlaying(false);
		setCursor(Math.max(0, Math.min(last, next)));
	};
	return (
		<View style={{ gap: 14 }}>
			<EscapeBoard state={frames[cursor]} />
			<EscapeHud state={frames[cursor]} />
			<Text style={styles.body}>
				Replay position {cursor} / {last}
			</Text>
			<View
				accessible
				accessibilityRole="adjustable"
				accessibilityLabel="Replay position"
				accessibilityValue={{ min: 0, max: last, now: cursor }}
				accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
				onAccessibilityAction={(event) =>
					seek(cursor + (event.nativeEvent.actionName === "increment" ? 1 : -1))
				}
			>
				<ReplayScrubber position={cursor} last={last} onSeek={seek} />
			</View>
			<View style={[styles.row, { flexWrap: "wrap" }]}>
				<Button
					title={playing && cursor < last ? "Pause replay" : "Play replay"}
					onPress={() => {
						if (cursor === last) {
							setCursor(0);
						}
						setPlaying(!playing || cursor === last);
					}}
				/>
				<Button
					title="Previous turn"
					secondary
					disabled={cursor === 0}
					onPress={() => seek(cursor - 1)}
				/>
				<Button
					title="Next turn"
					secondary
					disabled={cursor === last}
					onPress={() => seek(cursor + 1)}
				/>
				<Button title="Restart replay" secondary onPress={() => seek(0)} />
			</View>
		</View>
	);
}
function ReplayScrubber({
	position,
	last,
	onSeek,
}: {
	position: number;
	last: number;
	onSeek: (value: number) => void;
}) {
	const [width, setWidth] = useState(0);
	return (
		<View
			style={{ height: 44, justifyContent: "center" }}
			onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
			onStartShouldSetResponder={() => true}
			onMoveShouldSetResponder={() => true}
			onResponderGrant={(event) => {
				if (width) {
					onSeek(Math.round((event.nativeEvent.locationX / width) * last));
				}
			}}
			onResponderMove={(event) => {
				if (width) {
					onSeek(Math.round((event.nativeEvent.locationX / width) * last));
				}
			}}
		>
			<View
				pointerEvents="none"
				style={{ height: 6, backgroundColor: "#31483B", borderRadius: 3 }}
			>
				<View
					style={{
						height: 6,
						width: `${last ? (position / last) * 100 : 0}%`,
						borderRadius: 3,
						backgroundColor: "#D2EF9A",
					}}
				/>
			</View>
		</View>
	);
}

export function EscapeReplay({ id }: { id: string }) {
	const [copied, setCopied] = useState(false);
	const replay = useQuery({
		queryKey: ["escape-replay", id],
		queryFn: async ({ signal }) => {
			const { data } = await client.GET("/public/escape/runs/{id}", {
				params: { path: { id } },
				signal,
			});
			if (!data) {
				throw new Error("This Escape replay is unavailable.");
			}
			return {
				run: data.run,
				frames: escapeReplayFrames(data.run.levelId, data.run.moves),
			};
		},
	});
	const share = useMutation({
		mutationFn: () =>
			Share.share({
				url: escapeRunUrl(id),
				title: "The Lounge · Sandbox Escape",
			}),
	});
	return (
		<Screen>
			{replay.isPending && <Loading />}
			<ErrorNotice error={replay.error ?? share.error} />
			{replay.isError && (
				<Button
					title="Retry loading replay"
					onPress={() => void replay.refetch()}
				/>
			)}
			{replay.data && (
				<>
					<Text style={styles.heading}>
						{replay.data.run.levelName} · {replay.data.run.outcome}
					</Text>
					<Text style={styles.body}>{replay.data.run.model}</Text>
					<Text style={styles.muted}>
						Score {replay.data.run.score} · {replay.data.run.steps} steps · $
						{replay.data.run.cost.toFixed(4)}
					</Text>
					<Text style={styles.muted}>
						{replay.data.run.promptTokens} input ·{" "}
						{replay.data.run.completionTokens} output tokens
					</Text>
					<Playback key={id} frames={replay.data.frames} />
					<Text style={styles.muted}>
						Replay uses saved moves and does not call a model. Anyone with the
						link can watch this run.
					</Text>
					<Button
						title="Share replay"
						busy={share.isPending}
						onPress={() => share.mutate()}
					/>
					<Button
						title={copied ? "Replay link copied" : "Copy replay link"}
						secondary
						onPress={() => {
							Clipboard.setString(escapeRunUrl(id));
							setCopied(true);
						}}
					/>
				</>
			)}
		</Screen>
	);
}
