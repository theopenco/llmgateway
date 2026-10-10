"use client";

import {
	AlertCircle,
	CornerDownLeft,
	Download,
	FolderDown,
	ImageIcon,
	ImagePlus,
	Loader2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import prettyBytes from "pretty-bytes";
import { memo, useEffect, useState } from "react";
import { toast } from "sonner";

import { Actions, Action } from "@/components/ai-elements/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageZoom } from "@/components/ui/image-zoom";
import { Skeleton } from "@/components/ui/skeleton";
import { useGalleryImage } from "@/hooks/useGalleryImage";
import {
	heroSuggestionGroups,
	sampleSuggestions,
} from "@/lib/hero-suggestions";
import {
	downloadImage,
	downloadImagesAsZip,
	imageFileStem,
	type ZipEntry,
} from "@/lib/image-download";

import type { GalleryImage, GalleryItem } from "@/lib/image-gen";

interface ImageGalleryProps {
	items: GalleryItem[];
	comparisonMode: boolean;
	onSuggestionClick?: (prompt: string) => void;
	onUseAsReference?: (image: GalleryImage) => void;
	onInsertPrompt?: (prompt: string) => void;
}

function describeError(error: unknown, fallback: string) {
	return error instanceof Error ? error.message : fallback;
}

function modelSlug(modelId: string) {
	return modelId.replace(/[^a-z0-9.-]+/gi, "-");
}

const GalleryImageTile = memo(
	({
		image,
		stem,
		modelName,
	}: {
		image: GalleryImage;
		stem: string;
		modelName?: string;
	}) => {
		const resolved = useGalleryImage(image);
		const [isDownloading, setIsDownloading] = useState(false);
		const details =
			resolved?.width && resolved.height
				? `${resolved.width}×${resolved.height}${
						resolved.bytes ? ` · ${prettyBytes(resolved.bytes)}` : ""
					}`
				: null;

		const handleDownload = async () => {
			setIsDownloading(true);
			try {
				await downloadImage(image, stem);
			} catch (error) {
				toast.error(describeError(error, "Download failed"));
			} finally {
				setIsDownloading(false);
			}
		};

		return (
			<div className="group relative h-64 overflow-hidden rounded-lg border bg-muted/30">
				{resolved ? (
					<ImageZoom
						className="h-full w-full"
						zoomImg={{ src: resolved.fullUrl, alt: "Generated image" }}
					>
						<img
							src={resolved.previewUrl}
							alt="Generated image"
							loading="lazy"
							decoding="async"
							className="h-full w-full object-cover"
						/>
					</ImageZoom>
				) : (
					<Skeleton className="h-full w-full rounded-none" />
				)}
				<div className="absolute top-2 right-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
					<Button
						variant="secondary"
						size="icon"
						aria-label="Download image"
						className="h-8 w-8 bg-background/80 backdrop-blur-sm"
						disabled={!resolved || isDownloading}
						onClick={handleDownload}
					>
						{isDownloading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Download className="h-4 w-4" />
						)}
					</Button>
				</div>
				{(modelName || details) && (
					<div className="absolute bottom-2 left-2 flex flex-wrap gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
						{modelName && (
							<Badge
								variant="secondary"
								className="bg-background/80 backdrop-blur-sm text-xs"
							>
								{modelName}
							</Badge>
						)}
						{details && (
							<Badge
								variant="secondary"
								className="bg-background/80 backdrop-blur-sm text-xs tabular-nums"
							>
								{details}
							</Badge>
						)}
					</div>
				)}
			</div>
		);
	},
);
GalleryImageTile.displayName = "GalleryImageTile";

function LoadingSkeleton({ count }: { count: number }) {
	return (
		<div className="grid grid-cols-2 gap-3 max-w-lg">
			{Array.from({ length: count }).map((_, i) => (
				<Skeleton key={i} className="h-64 rounded-lg" />
			))}
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
		() =>
			setSuggestions(sampleSuggestions(heroSuggestionGroups["Image gen"], 6)),
		[],
	);

	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<ImageIcon className="h-16 w-16 text-muted-foreground/30 mb-6" />
			<h3 className="text-lg font-medium mb-2">No images yet</h3>
			<p className="text-sm text-muted-foreground mb-8 max-w-md">
				Describe what you want to create and click Generate to get started.
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

function InputImageThumbnail({
	image,
	index,
}: {
	image: GalleryImage;
	index: number;
}) {
	const resolved = useGalleryImage(image);
	if (!resolved) {
		return <Skeleton className="h-6 w-6 rounded" />;
	}
	return (
		<img
			src={resolved.previewUrl}
			alt={`Input ${index + 1}`}
			loading="lazy"
			className="h-6 w-6 rounded border object-cover"
		/>
	);
}

function InputImageThumbnails({ images }: { images?: GalleryImage[] }) {
	if (!images || images.length === 0) {
		return null;
	}

	return (
		<div className="flex gap-1 shrink-0">
			{images.map((image, i) => (
				<InputImageThumbnail key={i} image={image} index={i} />
			))}
		</div>
	);
}

function ItemHeader({ item }: { item: GalleryItem }) {
	return (
		<div className="flex items-center gap-2">
			<InputImageThumbnails images={item.inputImages} />
			<p className="text-sm text-muted-foreground truncate flex-1">
				{item.prompt}
			</p>
			<span className="text-xs text-muted-foreground shrink-0">
				{new Date(item.timestamp).toLocaleTimeString()}
			</span>
		</div>
	);
}

function ModelError({ message }: { message: string }) {
	return (
		<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
			<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
			<p className="text-sm text-destructive">{message}</p>
		</div>
	);
}

// Per-tile download names: "<prompt>-2.png" in single mode, and
// "<prompt>-<model>-2.png" when several models are compared.
function tileStem(item: GalleryItem, modelId: string, index: number) {
	const stem = imageFileStem(item.prompt);
	const suffix = item.models.length > 1 ? `-${modelSlug(modelId)}` : "";
	const images = item.models.find((m) => m.modelId === modelId)?.images ?? [];
	return images.length > 1 || suffix ? `${stem}${suffix}-${index + 1}` : stem;
}

function ItemActions({
	item,
	onUseAsReference,
	onInsertPrompt,
}: {
	item: GalleryItem;
	onUseAsReference?: (image: GalleryImage) => void;
	onInsertPrompt?: (prompt: string) => void;
}) {
	const [isZipping, setIsZipping] = useState(false);
	const firstImage = item.models[0]?.images[0];
	const entries: ZipEntry[] = item.models.flatMap((model) =>
		model.images.map((image, index) => ({
			image,
			stem: tileStem(item, model.modelId, index),
		})),
	);

	if (!firstImage && !onInsertPrompt) {
		return null;
	}

	const handleDownloadAll = async () => {
		setIsZipping(true);
		try {
			await downloadImagesAsZip(entries, imageFileStem(item.prompt));
		} catch (error) {
			toast.error(describeError(error, "Download failed"));
		} finally {
			setIsZipping(false);
		}
	};

	return (
		<Actions>
			{entries.length > 1 && (
				<Action
					tooltip={`Download all ${entries.length} images as a zip`}
					disabled={isZipping}
					onClick={handleDownloadAll}
				>
					{isZipping ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<FolderDown className="h-4 w-4" />
					)}
				</Action>
			)}
			{firstImage && onUseAsReference && (
				<Action
					tooltip="Use as image reference"
					onClick={() => onUseAsReference(firstImage)}
				>
					<ImagePlus className="h-4 w-4" />
				</Action>
			)}
			{onInsertPrompt && (
				<Action
					tooltip="Insert prompt"
					onClick={() => onInsertPrompt(item.prompt)}
				>
					<CornerDownLeft className="h-4 w-4" />
				</Action>
			)}
		</Actions>
	);
}

function SingleModeItem({
	item,
	onUseAsReference,
	onInsertPrompt,
}: {
	item: GalleryItem;
	onUseAsReference?: (image: GalleryImage) => void;
	onInsertPrompt?: (prompt: string) => void;
}) {
	const model = item.models[0];
	if (!model) {
		return null;
	}

	return (
		<div className="space-y-2">
			<ItemHeader item={item} />
			{model.error ? (
				<ModelError message={model.error} />
			) : model.images.length === 0 && model.isLoading ? (
				<LoadingSkeleton count={Math.max(1, model.imageCount ?? 1)} />
			) : (
				<div
					className={`grid gap-3 ${
						model.images.length === 1 && !model.isLoading
							? "grid-cols-1 max-w-xs"
							: "grid-cols-2 max-w-lg"
					}`}
				>
					{model.images.map((image, idx) => (
						<GalleryImageTile
							key={idx}
							image={image}
							stem={tileStem(item, model.modelId, idx)}
						/>
					))}
					{model.isLoading && <Skeleton className="h-64 rounded-lg" />}
				</div>
			)}
			{!model.isLoading && (
				<ItemActions
					item={item}
					onUseAsReference={onUseAsReference}
					onInsertPrompt={onInsertPrompt}
				/>
			)}
		</div>
	);
}

function ComparisonModeItem({
	item,
	onUseAsReference,
	onInsertPrompt,
}: {
	item: GalleryItem;
	onUseAsReference?: (image: GalleryImage) => void;
	onInsertPrompt?: (prompt: string) => void;
}) {
	return (
		<div className="space-y-2">
			<ItemHeader item={item} />
			<div
				className={`grid gap-4 ${
					item.models.length === 1
						? "grid-cols-1"
						: item.models.length === 2
							? "grid-cols-1 md:grid-cols-2"
							: "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
				}`}
			>
				{item.models.map((model) => (
					<div key={model.modelId} className="space-y-2">
						<Badge variant="outline" className="text-xs">
							{model.modelName}
						</Badge>
						{model.error ? (
							<ModelError message={model.error} />
						) : model.images.length === 0 && model.isLoading ? (
							<LoadingSkeleton count={Math.max(1, model.imageCount ?? 1)} />
						) : (
							<div
								className={`grid gap-2 ${
									model.images.length === 1 && !model.isLoading
										? "grid-cols-1"
										: "grid-cols-2"
								}`}
							>
								{model.images.map((image, idx) => (
									<GalleryImageTile
										key={idx}
										image={image}
										stem={tileStem(item, model.modelId, idx)}
										modelName={model.modelName}
									/>
								))}
								{model.isLoading && <Skeleton className="h-64 rounded-lg" />}
							</div>
						)}
					</div>
				))}
			</div>
			{!item.models.some((m) => m.isLoading) && (
				<ItemActions
					item={item}
					onUseAsReference={onUseAsReference}
					onInsertPrompt={onInsertPrompt}
				/>
			)}
		</div>
	);
}

export function ImageGallery({
	items,
	comparisonMode,
	onSuggestionClick,
	onUseAsReference,
	onInsertPrompt,
}: ImageGalleryProps) {
	if (items.length === 0) {
		return <EmptyState onSuggestionClick={onSuggestionClick} />;
	}

	return (
		<div className="space-y-8">
			{items.map((item) => (
				<div key={item.id} id={`gallery-${item.id}`}>
					{comparisonMode ? (
						<ComparisonModeItem
							item={item}
							onUseAsReference={onUseAsReference}
							onInsertPrompt={onInsertPrompt}
						/>
					) : (
						<SingleModeItem
							item={item}
							onUseAsReference={onUseAsReference}
							onInsertPrompt={onInsertPrompt}
						/>
					)}
				</div>
			))}
		</div>
	);
}
