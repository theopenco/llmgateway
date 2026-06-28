"use client";

import { AlertCircle, AudioLines, Download } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { memo, useEffect, useState } from "react";

import { Audio } from "@/components/ai-elements/audio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadAudio } from "@/lib/audio-gen";
import {
	audioStudioSuggestions,
	sampleSuggestions,
} from "@/lib/hero-suggestions";

import type { AudioGalleryItem, GeneratedAudio } from "@/lib/audio-gen";

interface AudioGalleryProps {
	items: AudioGalleryItem[];
	comparisonMode: boolean;
	onSuggestionClick?: (prompt: string) => void;
}

const GalleryAudio = memo(
	({ audio, modelName }: { audio: GeneratedAudio; modelName?: string }) => (
		<div className="flex items-center gap-2 rounded-lg border p-3">
			<Audio
				base64={audio.base64}
				mediaType={audio.mediaType}
				aria-label={modelName ? `${modelName} audio` : "Generated audio"}
				className="min-w-0 flex-1"
			/>
			<Button
				variant="secondary"
				size="icon"
				className="h-8 w-8 shrink-0"
				aria-label={
					modelName ? `Download ${modelName} audio` : "Download audio"
				}
				onClick={() => downloadAudio(audio)}
			>
				<Download className="h-4 w-4" />
			</Button>
		</div>
	),
);

function LoadingSkeleton() {
	return <Skeleton className="h-16 rounded-lg max-w-xl" />;
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
		() => setSuggestions(sampleSuggestions(audioStudioSuggestions, 6)),
		[],
	);

	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<AudioLines className="h-16 w-16 text-muted-foreground/30 mb-6" />
			<h3 className="text-lg font-medium mb-2">No audio yet</h3>
			<p className="text-sm text-muted-foreground mb-8 max-w-md">
				Enter the text you want to hear and click Generate to get started.
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

function SingleModeItem({ item }: { item: AudioGalleryItem }) {
	const model = item.models[0];
	if (!model) {
		return null;
	}

	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<p className="text-sm text-muted-foreground truncate flex-1">
					{item.prompt}
				</p>
				{item.voice && (
					<Badge variant="outline" className="text-xs shrink-0">
						{item.voice}
					</Badge>
				)}
				<span className="text-xs text-muted-foreground shrink-0">
					{new Date(item.timestamp).toLocaleTimeString()}
				</span>
			</div>
			{model.error ? (
				<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
					<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
					<p className="text-sm text-destructive">{model.error}</p>
				</div>
			) : model.isLoading ? (
				<LoadingSkeleton />
			) : model.audio ? (
				<div className="max-w-xl">
					<GalleryAudio audio={model.audio} modelName={model.modelName} />
				</div>
			) : null}
		</div>
	);
}

function ComparisonModeItem({ item }: { item: AudioGalleryItem }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
				<p className="text-sm text-muted-foreground truncate flex-1">
					{item.prompt}
				</p>
				{item.voice && (
					<Badge variant="outline" className="text-xs shrink-0">
						{item.voice}
					</Badge>
				)}
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
				{item.models.map((model, idx) => (
					<div key={`${model.modelId}-${idx}`} className="space-y-2">
						<Badge variant="outline" className="text-xs">
							{model.modelName}
						</Badge>
						{model.error ? (
							<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
								<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
								<p className="text-sm text-destructive">{model.error}</p>
							</div>
						) : model.isLoading ? (
							<LoadingSkeleton />
						) : model.audio ? (
							<GalleryAudio audio={model.audio} modelName={model.modelName} />
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}

export function AudioGallery({
	items,
	comparisonMode,
	onSuggestionClick,
}: AudioGalleryProps) {
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
