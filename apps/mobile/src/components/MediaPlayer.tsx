import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useEvent, useVideoPlayer, VideoView } from "react-native-video";

import { Button, ErrorNotice, styles } from "@/components/ui";

function time(seconds: number) {
	const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
	return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function MediaPlayer({
	uri,
	audio = false,
}: {
	uri: string;
	audio?: boolean;
}) {
	const focused = useIsFocused();
	const [playing, setPlaying] = useState(false);
	const [ended, setEnded] = useState(false);
	const [ready, setReady] = useState(false);
	const [position, setPosition] = useState(0);
	const [duration, setDuration] = useState(0);
	const [error, setError] = useState<Error>();
	const player = useVideoPlayer({ uri }, (instance) => {
		instance.playInBackground = false;
		instance.playWhenInactive = false;
	});
	useEvent(player, "onStatusChange", (status) => {
		setReady(status === "readyToPlay");
		if (status === "error") {
			setError(
				(current) =>
					current ??
					new Error("This media could not be loaded. Try refreshing it."),
			);
		}
	});
	useEvent(player, "onLoad", (event) => {
		setDuration(event.duration);
		setReady(true);
	});
	useEvent(player, "onProgress", (event) => setPosition(event.currentTime));
	useEvent(player, "onPlaybackStateChange", (event) =>
		setPlaying(event.isPlaying),
	);
	useEvent(player, "onEnd", () => {
		setEnded(true);
		setPlaying(false);
	});
	useEvent(player, "onError", (event) => setError(new Error(event.message)));
	useEffect(() => {
		setReady(player.status === "readyToPlay");
		setDuration(player.duration);
		setPosition(0);
		setPlaying(false);
		setEnded(false);
		setError(
			player.status === "error"
				? new Error("This media could not be loaded. Try refreshing it.")
				: undefined,
		);
	}, [player]);
	useEffect(() => {
		if (!focused) {
			player.pause();
		}
	}, [focused, player]);
	const control = (action: () => void) => {
		try {
			action();
		} catch (cause) {
			setError(cause instanceof Error ? cause : new Error("Playback failed."));
		}
	};
	return (
		<View style={{ gap: 10 }}>
			{!audio && (
				<VideoView
					player={player}
					controls
					resizeMode="contain"
					keepScreenAwake={playing}
					style={{
						width: "100%",
						aspectRatio: 16 / 9,
						backgroundColor: "#000000",
						borderRadius: 12,
					}}
				/>
			)}
			<ErrorNotice error={error} />
			<Text
				style={styles.muted}
				accessibilityLabel={`Playback ${time(position)} of ${time(duration)}`}
			>
				{time(position)} / {time(duration)}
			</Text>
			<View style={[styles.row, { flexWrap: "wrap" }]}>
				<Button
					title={playing ? "Pause playback" : ended ? "Replay" : "Play"}
					disabled={!ready || !!error}
					onPress={() =>
						control(() => {
							if (playing) {
								player.pause();
							} else {
								if (ended) {
									player.seekTo(0);
									setEnded(false);
								}
								player.play();
							}
						})
					}
				/>
				{audio && (
					<>
						<Button
							title="Back 10 seconds"
							secondary
							disabled={!ready || !!error}
							onPress={() =>
								control(() => player.seekTo(Math.max(0, position - 10)))
							}
						/>
						<Button
							title="Forward 10 seconds"
							secondary
							disabled={!ready || !!error}
							onPress={() =>
								control(() => player.seekTo(Math.min(duration, position + 10)))
							}
						/>
					</>
				)}
			</View>
		</View>
	);
}
