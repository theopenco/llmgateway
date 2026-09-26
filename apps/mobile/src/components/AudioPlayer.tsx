import { useIsFocused } from "@react-navigation/native";
import { useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import {
	Audio,
	AudioContext,
	useAudioTagContext,
} from "react-native-audio-api";

import { Button, ErrorNotice, Loading, styles } from "@/components/ui";
import { playbackTime } from "@/lib/playback-time";

function PlaybackControls({
	error,
	onError,
}: {
	error: unknown;
	onError: (error: unknown) => void;
}) {
	const focused = useIsFocused();
	const {
		play,
		pause,
		seekToTime,
		ready,
		playbackState,
		currentTime,
		duration,
	} = useAudioTagContext();
	const playing = playbackState === "playing";
	const ended = duration > 0 && currentTime >= duration;
	useEffect(() => {
		if (!focused) {
			pause();
		}
	}, [focused, pause]);
	useEffect(() => {
		const subscription = AppState.addEventListener("change", (state) => {
			if (state !== "active") {
				pause();
			}
		});
		return () => subscription.remove();
	}, [pause]);
	const control = async (action: () => void) => {
		try {
			await action();
		} catch (cause) {
			onError(cause);
		}
	};
	return (
		<View style={{ gap: 10 }}>
			<ErrorNotice error={error} />
			<Text
				style={styles.muted}
				accessibilityLabel={`Playback ${playbackTime(currentTime)} of ${playbackTime(duration)}`}
			>
				{playbackTime(currentTime)} / {playbackTime(duration)}
			</Text>
			<View style={[styles.row, { flexWrap: "wrap" }]}>
				<Button
					title={playing ? "Pause playback" : ended ? "Replay" : "Play"}
					disabled={!ready || !!error || !focused}
					onPress={() =>
						void control(() => {
							if (playing) {
								return pause();
							}
							if (ended) {
								seekToTime(0);
							}
							return play();
						})
					}
				/>
				<Button
					title="Back 10 seconds"
					secondary
					disabled={!ready || !!error}
					onPress={() =>
						void control(() => seekToTime(Math.max(0, currentTime - 10)))
					}
				/>
				<Button
					title="Forward 10 seconds"
					secondary
					disabled={!ready || !!error}
					onPress={() =>
						void control(() => seekToTime(Math.min(duration, currentTime + 10)))
					}
				/>
			</View>
		</View>
	);
}

export function AudioPlayer({ uri }: { uri: string }) {
	const [error, setError] = useState<unknown>();
	const [context, setContext] = useState<AudioContext>();
	useEffect(() => {
		const audioContext = new AudioContext();
		setContext(audioContext);
		return () => {
			void audioContext.close().catch((cause: unknown) => {
				// eslint-disable-next-line no-console -- Cleanup finishes after the screen unmounts.
				console.warn("Could not close audio playback", cause);
			});
		};
	}, []);
	if (!context) {
		return <Loading />;
	}
	return (
		<Audio
			context={context}
			source={uri}
			preload="auto"
			controls={false}
			onError={setError}
		>
			<PlaybackControls error={error} onError={setError} />
		</Audio>
	);
}
