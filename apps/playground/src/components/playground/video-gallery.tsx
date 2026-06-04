"use client";

import { AlertCircle, Download, Film } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useState, useCallback } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
	videoStudioSuggestions,
	sampleSuggestions,
} from "@/lib/hero-suggestions";
import { downloadVideo } from "@/lib/video-gen";

import type { VideoGalleryItem } from "@/lib/video-gen";

const VIDEO_EXPIRY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARN_THRESHOLD_S = 60 * 60;

function isExpiredByTime(expiresAt: number | null, timestamp: number): boolean {
	if (expiresAt !== null) {
		return Math.floor(Date.now() / 1000) > expiresAt;
	}
	return Date.now() - timestamp > VIDEO_EXPIRY_MS;
}

function isExpiringSoon(expiresAt: number | null): boolean {
	if (expiresAt === null) {
		return false;
	}
	const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
	return secondsLeft > 0 && secondsLeft < EXPIRY_WARN_THRESHOLD_S;
}

function formatTimeUntilExpiry(expiresAt: number): string {
	const secondsLeft = expiresAt - Math.floor(Date.now() / 1000);
	if (secondsLeft < 60) {
		return "less than a minute";
	}
	if (secondsLeft < 3600) {
		return `${Math.floor(secondsLeft / 60)} min`;
	}
	return `${Math.floor(secondsLeft / 3600)} h`;
}

interface VideoGalleryProps {
	items: VideoGalleryItem[];
	comparisonMode: boolean;
	onSuggestionClick?: (prompt: string) => void;
}

const VideoPlayer = memo(
	({
		url,
		modelName,
		expiresAt,
		onLoadError,
	}: {
		url: string;
		modelName?: string;
		expiresAt?: number | null;
		onLoadError: () => void;
	}) => {
		const handleError = useCallback(() => {
			onLoadError();
		}, [onLoadError]);

		const expiringSoon = isExpiringSoon(expiresAt ?? null);

		return (
			<div className="group relative overflow-hidden rounded-lg border">
				<video
					src={url}
					controls
					autoPlay
					loop
					playsInline
					className="w-full rounded-lg"
					onError={handleError}
				/>
				<div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
					<Button
						variant="secondary"
						size="icon"
						className="h-8 w-8 bg-background/80 backdrop-blur-sm"
						onClick={() => downloadVideo(url)}
					>
						<Download className="h-4 w-4" />
					</Button>
				</div>
				{modelName && (
					<div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
						<Badge
							variant="secondary"
							className="bg-background/80 backdrop-blur-sm text-xs"
						>
							{modelName}
						</Badge>
					</div>
				)}
				{expiringSoon && expiresAt && (
					<div className="absolute top-2 left-2">
						<Badge
							variant="secondary"
							className="bg-amber-500/90 text-white text-xs backdrop-blur-sm"
						>
							Expires in {formatTimeUntilExpiry(expiresAt)}
						</Badge>
					</div>
				)}
			</div>
		);
	},
);

function VideoProgress({
	status,
	progress,
}: {
	status: string;
	progress: number | null;
}) {
	const progressValue = progress ?? 0;
	const label =
		status === "queued" ? "Queued..." : `Generating... ${progressValue}%`;

	return (
		<div className="relative overflow-hidden rounded-lg border bg-muted/30">
			<div className="flex flex-col items-center justify-center py-16 px-4 gap-4">
				<Film className="h-10 w-10 text-muted-foreground/50 animate-pulse" />
				<div className="w-full max-w-xs space-y-2">
					<Progress value={progressValue} className="h-2" />
					<p className="text-sm text-muted-foreground text-center">{label}</p>
				</div>
			</div>
		</div>
	);
}

function EmptyState({
	onSuggestionClick,
}: {
	onSuggestionClick?: (prompt: string) => void;
}) {
	const [suggestions, setSuggestions] = useState<readonly string[] | null>(
		null,
	);
	useEffect(
		() => setSuggestions(sampleSuggestions(videoStudioSuggestions, 6)),
		[],
	);

	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<Film className="h-16 w-16 text-muted-foreground/30 mb-6" />
			<h3 className="text-lg font-medium mb-2">No videos yet</h3>
			<p className="text-sm text-muted-foreground mb-8 max-w-md">
				Describe the video you want to create and click Generate to get started.
			</p>
			<AnimatePresence>
				{suggestions ? (
					<motion.div
						key="suggestions"
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: 0.07, ease: "easeOut" }}
						className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full"
					>
						{suggestions.map((s, index) => (
							<motion.button
								key={s}
								type="button"
								initial={{ opacity: 0, y: -6 }}
								animate={{ opacity: 1, y: 0 }}
								transition={{
									duration: 0.12,
									delay: index * 0.025,
									ease: "easeOut",
								}}
								onClick={() => onSuggestionClick?.(s)}
								className="rounded-md border px-4 py-3 text-left text-sm hover:bg-muted/60 transition-colors"
							>
								{s}
							</motion.button>
						))}
					</motion.div>
				) : null}
			</AnimatePresence>
		</div>
	);
}

function VideoInputThumbnails({ item }: { item: VideoGalleryItem }) {
	const images: { src: string; label: string }[] = [];

	if (item.frameInputs?.start) {
		images.push({ src: item.frameInputs.start.dataUrl, label: "First frame" });
	}
	if (item.frameInputs?.end) {
		images.push({ src: item.frameInputs.end.dataUrl, label: "Last frame" });
	}
	if (item.referenceImages) {
		item.referenceImages.forEach((ref, i) => {
			images.push({ src: ref.dataUrl, label: `Reference ${i + 1}` });
		});
	}

	if (images.length === 0) {
		return null;
	}

	return (
		<div className="flex gap-1 shrink-0">
			{images.map((img, i) => (
				<img
					key={i}
					src={img.src}
					alt={img.label}
					title={img.label}
					className="h-6 w-6 rounded border object-cover"
				/>
			))}
		</div>
	);
}

function SingleModeItem({ item }: { item: VideoGalleryItem }) {
	const model = item.models[0];
	const [loadError, setLoadError] = useState(false);

	if (!model) {
		return null;
	}

	const expired = isExpiredByTime(model.expiresAt, item.timestamp);
	const unavailable = loadError && !expired;

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<VideoInputThumbnails item={item} />
				<p className="text-sm text-muted-foreground truncate flex-1">
					{item.prompt}
				</p>
				<span className="text-xs text-muted-foreground shrink-0">
					{new Date(item.timestamp).toLocaleTimeString()}
				</span>
			</div>
			{model.error ? (
				<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
					<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
					<p className="text-sm text-destructive">{model.error}</p>
				</div>
			) : model.isLoading && model.job ? (
				<div className="max-w-lg">
					<VideoProgress
						status={model.job.status}
						progress={model.job.progress}
					/>
				</div>
			) : model.isLoading ? (
				<Skeleton className="h-64 max-w-lg rounded-lg" />
			) : model.videoUrl ? (
				<div className="max-w-lg">
					{expired ? (
						<div className="flex items-center justify-center h-32 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
							Video expired
						</div>
					) : unavailable ? (
						<div className="flex flex-col items-center justify-center h-32 rounded-lg border bg-muted/30 gap-1">
							<p className="text-sm text-muted-foreground">Video unavailable</p>
							<p className="text-xs text-muted-foreground/70">
								The video may no longer be available from the provider
							</p>
						</div>
					) : (
						<VideoPlayer
							url={model.videoUrl}
							expiresAt={model.expiresAt}
							onLoadError={() => setLoadError(true)}
						/>
					)}
				</div>
			) : null}
		</div>
	);
}

function ComparisonModeItem({ item }: { item: VideoGalleryItem }) {
	const [loadErrorModels, setLoadErrorModels] = useState<Set<string>>(
		new Set(),
	);

	const handleLoadError = useCallback((modelId: string) => {
		setLoadErrorModels((prev) => new Set(Array.from(prev).concat(modelId)));
	}, []);

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<VideoInputThumbnails item={item} />
				<p className="text-sm text-muted-foreground truncate flex-1">
					{item.prompt}
				</p>
				<span className="text-xs text-muted-foreground shrink-0">
					{new Date(item.timestamp).toLocaleTimeString()}
				</span>
			</div>
			<div
				className={`grid gap-4 ${
					item.models.length === 1
						? "grid-cols-1"
						: item.models.length === 2
							? "grid-cols-1 md:grid-cols-2"
							: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
				}`}
			>
				{item.models.map((model) => {
					const expired = isExpiredByTime(model.expiresAt, item.timestamp);
					const unavailable = loadErrorModels.has(model.modelId) && !expired;
					return (
						<div key={model.modelId} className="space-y-2">
							<Badge variant="outline" className="text-xs">
								{model.modelName}
							</Badge>
							{model.error ? (
								<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
									<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
									<p className="text-sm text-destructive">{model.error}</p>
								</div>
							) : model.isLoading && model.job ? (
								<VideoProgress
									status={model.job.status}
									progress={model.job.progress}
								/>
							) : model.isLoading ? (
								<Skeleton className="h-64 rounded-lg" />
							) : model.videoUrl ? (
								expired ? (
									<div className="flex items-center justify-center h-32 rounded-lg border bg-muted/30 text-sm text-muted-foreground">
										Video expired
									</div>
								) : unavailable ? (
									<div className="flex flex-col items-center justify-center h-32 rounded-lg border bg-muted/30 gap-1">
										<p className="text-sm text-muted-foreground">
											Video unavailable
										</p>
										<p className="text-xs text-muted-foreground/70">
											The video may no longer be available from the provider
										</p>
									</div>
								) : (
									<VideoPlayer
										url={model.videoUrl}
										modelName={model.modelName}
										expiresAt={model.expiresAt}
										onLoadError={() => handleLoadError(model.modelId)}
									/>
								)
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function VideoGallery({
	items,
	comparisonMode,
	onSuggestionClick,
}: VideoGalleryProps) {
	if (items.length === 0) {
		return <EmptyState onSuggestionClick={onSuggestionClick} />;
	}

	return (
		<div className="space-y-8">
			{items.map((item) => (
				<div key={item.id} id={`gallery-${item.id}`}>
					{comparisonMode ? (
						<ComparisonModeItem item={item} />
					) : (
						<SingleModeItem item={item} />
					)}
				</div>
			))}
		</div>
	);
}
