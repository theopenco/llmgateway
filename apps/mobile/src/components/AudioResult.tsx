import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { Dirs, FileSystem } from "react-native-file-access";

import { AudioPlayer } from "@/components/AudioPlayer";
import { Button, ErrorNotice, Loading, styles } from "@/components/ui";
import { exportFile } from "@/lib/export-file";

import type { AudioResult as Result } from "@/api/audio";

let audioSequence = 0;

function audioExtension(mediaType: string) {
	if (/wav/.test(mediaType)) {
		return "wav";
	}
	if (/aac/.test(mediaType)) {
		return "aac";
	}
	if (/flac/.test(mediaType)) {
		return "flac";
	}
	if (/ogg|opus/.test(mediaType)) {
		return "opus";
	}
	return "mp3";
}

function LocalAudio({ audio }: { audio: NonNullable<Result["audio"]> }) {
	const [uri, setUri] = useState<string>();
	const [error, setError] = useState<unknown>();
	useEffect(() => {
		let disposed = false;
		const path = `${Dirs.CacheDir}/lounge-audio-${Date.now()}-${++audioSequence}.${audioExtension(audio.mediaType)}`;
		setUri(undefined);
		setError(undefined);
		const write = FileSystem.writeFile(path, audio.base64, "base64");
		void write.then(
			() => {
				if (!disposed) {
					setUri(`file://${path}`);
				}
			},
			(cause: unknown) => {
				if (!disposed) {
					setError(cause);
				}
			},
		);
		return () => {
			disposed = true;
			void write
				.finally(async () => {
					if (await FileSystem.exists(path)) {
						await FileSystem.unlink(path);
					}
				})
				.catch((cause: unknown) => {
					// eslint-disable-next-line no-console -- Cleanup finishes after the screen unmounts.
					console.warn("Could not release local audio", cause);
				});
		};
	}, [audio.base64, audio.mediaType]);
	return (
		<>
			<ErrorNotice error={error} />
			{uri ? <AudioPlayer key={uri} uri={uri} /> : !error && <Loading />}
		</>
	);
}

export function AudioResult({ result }: { result: Result }) {
	const file = result.audio;
	const exportAudio = useMutation({
		mutationFn: async (action: "save" | "share") => {
			if (!file) {
				throw new Error("There is no audio to export.");
			}
			await exportFile(
				{
					base64: file.base64,
					name: `audio.${audioExtension(file.mediaType)}`,
				},
				action,
			);
		},
	});
	return (
		<View style={styles.card}>
			<Text style={styles.heading}>{result.modelName}</Text>
			<ErrorNotice error={result.error ? new Error(result.error) : undefined} />
			{file && <LocalAudio audio={file} />}
			{file && (
				<View style={styles.row}>
					<Button
						title="Save audio"
						disabled={exportAudio.isPending}
						onPress={() => exportAudio.mutate("save")}
					/>
					<Button
						title="Share audio"
						secondary
						disabled={exportAudio.isPending}
						onPress={() => exportAudio.mutate("share")}
					/>
				</View>
			)}
			<ErrorNotice error={exportAudio.error} />
		</View>
	);
}
