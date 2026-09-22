import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";

import { api } from "@/api/client";
import { MediaPlayer } from "@/components/MediaPlayer";
import { Button, ErrorNotice, Loading, styles } from "@/components/ui";
import { exportRemoteFile } from "@/lib/export-file";

import type { VideoResult as Result } from "@/api/videos";

export function VideoResult({ result }: { result: Result }) {
	const [playbackRevision, setPlaybackRevision] = useState(0);
	const job = api.useQuery(
		"get",
		"/video/{videoId}",
		{ params: { path: { videoId: result.jobId ?? "" } } },
		{
			enabled: !!result.jobId,
			staleTime: 0,
			refetchInterval: (query) => {
				const data = query.state.data;
				return !data?.error &&
					(data?.status === "queued" ||
						data?.status === "in_progress" ||
						(data?.status === "completed" && !data.content?.[0]?.url))
					? 3000
					: false;
			},
		},
	);
	const url = job.data?.content?.[0]?.url;
	const preparingPlayback =
		job.data?.status === "completed" && !url && !job.data.error;
	const refresh = useMutation({
		mutationFn: async () => {
			await job.refetch({ throwOnError: true });
			setPlaybackRevision((value) => value + 1);
		},
	});
	const exportFile = useMutation({
		mutationFn: async (action: "save" | "share") => {
			const fresh = await job.refetch({ throwOnError: true });
			const source = fresh.data?.content?.[0]?.url;
			if (!source) {
				throw new Error("This video is not available to download.");
			}
			await exportRemoteFile({ url: source, name: "video.mp4" }, action);
		},
	});
	return (
		<View style={styles.card}>
			<Text style={styles.heading}>{result.modelName}</Text>
			<ErrorNotice error={result.error ? new Error(result.error) : job.error} />
			{result.jobId && job.isPending && <Loading />}
			{job.data && (
				<Text style={styles.muted}>
					{preparingPlayback
						? "Preparing playback…"
						: `${job.data.status.replace("_", " ")}${job.data.progress !== null ? ` · ${job.data.progress}%` : ""}`}
				</Text>
			)}
			<ErrorNotice
				error={job.data?.error ? new Error(job.data.error.message) : undefined}
			/>
			{url && <MediaPlayer key={playbackRevision} uri={url} />}
			{url && (
				<View style={styles.row}>
					<Button
						title="Save video"
						disabled={exportFile.isPending}
						onPress={() => exportFile.mutate("save")}
					/>
					<Button
						title="Share video"
						secondary
						disabled={exportFile.isPending}
						onPress={() => exportFile.mutate("share")}
					/>
				</View>
			)}
			{result.jobId && (
				<Button
					title="Refresh video"
					secondary
					disabled={job.isFetching || refresh.isPending}
					onPress={() => refresh.mutate()}
				/>
			)}
			<ErrorNotice error={refresh.error ?? exportFile.error} />
		</View>
	);
}
