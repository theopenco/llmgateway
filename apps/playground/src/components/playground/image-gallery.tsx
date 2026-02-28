"use client";

import { Download, AlertCircle, ImageIcon } from "lucide-react";
import { memo } from "react";

import { Image } from "@/components/ai-elements/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ImageZoom } from "@/components/ui/image-zoom";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadImage } from "@/lib/image-gen";

import type { GalleryItem } from "@/lib/image-gen";

interface ImageGalleryProps {
	items: GalleryItem[];
	comparisonMode: boolean;
}

const imageSuggestions = [
	"A cyberpunk cityscape at night with neon lights reflecting on wet streets",
	"A serene mountain landscape at sunrise with mist in the valleys",
	"A futuristic robot assistant helping in a cozy kitchen",
	"An underwater scene with bioluminescent creatures in the deep ocean",
	"A steampunk airship flying over a Victorian-era city",
	"A magical forest with glowing mushrooms and fireflies",
];

const GalleryImage = memo(
	({
		base64,
		mediaType,
		modelName,
	}: {
		base64: string;
		mediaType: string;
		modelName?: string;
	}) => (
		<div className="group relative">
			<ImageZoom>
				<Image
					base64={base64}
					mediaType={mediaType}
					alt="Generated image"
					className="w-full h-auto aspect-auto border rounded-lg object-cover"
				/>
			</ImageZoom>
			<div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
				<Button
					variant="secondary"
					size="icon"
					className="h-8 w-8 bg-background/80 backdrop-blur-sm"
					onClick={() => downloadImage({ base64, mediaType })}
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
		</div>
	),
);

function LoadingSkeleton({ count }: { count: number }) {
	return (
		<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
			{Array.from({ length: count }).map((_, i) => (
				<Skeleton key={i} className="aspect-square rounded-lg" />
			))}
		</div>
	);
}

function EmptyState({
	onSuggestionClick,
}: {
	onSuggestionClick?: (prompt: string) => void;
}) {
	return (
		<div className="flex flex-col items-center justify-center py-20 text-center">
			<ImageIcon className="h-16 w-16 text-muted-foreground/30 mb-6" />
			<h3 className="text-lg font-medium mb-2">No images yet</h3>
			<p className="text-sm text-muted-foreground mb-8 max-w-md">
				Describe what you want to create and click Generate to get started.
			</p>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl w-full">
				{imageSuggestions.map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => onSuggestionClick?.(s)}
						className="rounded-md border px-4 py-3 text-left text-sm hover:bg-muted/60 transition-colors"
					>
						{s}
					</button>
				))}
			</div>
		</div>
	);
}

function SingleModeItem({ item }: { item: GalleryItem }) {
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
				<span className="text-xs text-muted-foreground shrink-0">
					{new Date(item.timestamp).toLocaleTimeString()}
				</span>
			</div>
			{model.isLoading ? (
				<LoadingSkeleton count={1} />
			) : model.error ? (
				<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
					<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
					<p className="text-sm text-destructive">{model.error}</p>
				</div>
			) : (
				<div
					className={`grid gap-3 ${
						model.images.length === 1
							? "grid-cols-1 max-w-lg"
							: "grid-cols-1 sm:grid-cols-2"
					}`}
				>
					{model.images.map((img, idx) => (
						<GalleryImage
							key={idx}
							base64={img.base64}
							mediaType={img.mediaType}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function ComparisonModeItem({ item }: { item: GalleryItem }) {
	return (
		<div className="space-y-2">
			<div className="flex items-center gap-2">
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
				{item.models.map((model) => (
					<div key={model.modelId} className="space-y-2">
						<Badge variant="outline" className="text-xs">
							{model.modelName}
						</Badge>
						{model.isLoading ? (
							<LoadingSkeleton count={1} />
						) : model.error ? (
							<div className="flex items-center gap-2 p-4 rounded-lg border border-destructive/50 bg-destructive/5">
								<AlertCircle className="h-4 w-4 text-destructive shrink-0" />
								<p className="text-sm text-destructive">{model.error}</p>
							</div>
						) : (
							<div
								className={`grid gap-2 ${
									model.images.length === 1
										? "grid-cols-1"
										: "grid-cols-1 sm:grid-cols-2"
								}`}
							>
								{model.images.map((img, idx) => (
									<GalleryImage
										key={idx}
										base64={img.base64}
										mediaType={img.mediaType}
										modelName={model.modelName}
									/>
								))}
							</div>
						)}
					</div>
				))}
			</div>
		</div>
	);
}

export function ImageGallery({
	items,
	comparisonMode,
	onSuggestionClick,
}: ImageGalleryProps & { onSuggestionClick?: (prompt: string) => void }) {
	if (items.length === 0) {
		return <EmptyState onSuggestionClick={onSuggestionClick} />;
	}

	return (
		<div className="space-y-8">
			{items.map((item) =>
				comparisonMode ? (
					<ComparisonModeItem key={item.id} item={item} />
				) : (
					<SingleModeItem key={item.id} item={item} />
				),
			)}
		</div>
	);
}
