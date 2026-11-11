"use client";

import { ImagePlus, Loader2, Sparkles, X, Zap } from "lucide-react";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { AspectRatioIcon } from "@/components/playground/aspect-ratio-icon";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { getModelImageConfig } from "@/lib/image-gen";
import { cn } from "@/lib/utils";

import type { AspectRatio } from "@/lib/image-gen";

export type ImageServiceTier = "default" | "flex";
export type ImageOutputFormat = "image" | "svg";

interface InputImage {
	dataUrl: string;
	mediaType: string;
}

interface ImageControlsProps {
	prompt: string;
	setPrompt: (prompt: string) => void;
	selectedModels: string[];
	imageAspectRatio: AspectRatio;
	setImageAspectRatio: (value: AspectRatio) => void;
	imageSize: string;
	setImageSize: (value: string) => void;
	alibabaImageSize: string;
	setAlibabaImageSize: (value: string) => void;
	imageQuality: string;
	setImageQuality: (value: string) => void;
	imageModeration: string;
	setImageModeration: (value: string) => void;
	imageCount: 1 | 2 | 3 | 4;
	setImageCount: (value: 1 | 2 | 3 | 4) => void;
	imageFormat: ImageOutputFormat;
	supportsSvgOutput: boolean;
	setImageFormat: (value: ImageOutputFormat) => void;
	serviceTier: ImageServiceTier;
	setServiceTier: (value: ImageServiceTier) => void;
	// Whether any model in the current selection offers the flex tier.
	supportsFlex: boolean;
	isGenerating: boolean;
	onGenerate: () => void;
	isEditModel: boolean;
	requiresImageInput: boolean;
	inputImages: InputImage[];
	setInputImages: Dispatch<SetStateAction<InputImage[]>>;
}

const aspectRatios: AspectRatio[] = [
	"auto",
	"1:1",
	"9:16",
	"16:9",
	"3:4",
	"4:3",
	"3:2",
	"2:3",
	"5:4",
	"4:5",
	"21:9",
	"1:4",
	"4:1",
	"1:8",
	"8:1",
];

export function ImageControls({
	prompt,
	setPrompt,
	selectedModels,
	imageAspectRatio,
	setImageAspectRatio,
	imageSize,
	setImageSize,
	alibabaImageSize,
	setAlibabaImageSize,
	imageQuality,
	setImageQuality,
	imageModeration,
	setImageModeration,
	imageCount,
	setImageCount,
	imageFormat,
	supportsSvgOutput,
	setImageFormat,
	serviceTier,
	setServiceTier,
	supportsFlex,
	isGenerating,
	onGenerate,
	isEditModel,
	requiresImageInput,
	inputImages,
	setInputImages,
}: ImageControlsProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const dropZoneRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState(false);

	// Derive config from first selected model (settings apply globally)
	const primaryModel = selectedModels[0] ?? "";
	const config = getModelImageConfig(primaryModel);
	const svgSelected = supportsSvgOutput && imageFormat === "svg";
	// SVG output takes no reference images, so attachments are off while it is on.
	const acceptsImages = isEditModel && !svgSelected;
	const maxInputImages = config.maxInputImages;
	const filteredAspectRatios = config.supportedAspectRatios ?? aspectRatios;

	useEffect(() => {
		if (
			config.supportedAspectRatios &&
			!config.supportedAspectRatios.includes(imageAspectRatio)
		) {
			setImageAspectRatio("auto");
		}
	}, [config.supportedAspectRatios, imageAspectRatio, setImageAspectRatio]);

	const addImageFile = useCallback(
		(file: File) => {
			if (!file.type.startsWith("image/")) {
				return;
			}
			if (!acceptsImages) {
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				setInputImages((prev) => {
					if (prev.length >= maxInputImages) {
						return prev;
					}
					return [
						...prev,
						{ dataUrl: reader.result as string, mediaType: file.type },
					];
				});
			};
			reader.readAsDataURL(file);
		},
		[acceptsImages, setInputImages, maxInputImages],
	);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (prompt.trim() && !isGenerating && canGenerate) {
				onGenerate();
			}
		}
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);
		for (const file of files) {
			if (inputImages.length >= maxInputImages) {
				break;
			}
			addImageFile(file);
		}
		// Reset input so same file can be re-selected
		e.target.value = "";
	};

	// Paste handler for images
	const handlePaste = useCallback(
		(e: React.ClipboardEvent) => {
			if (!acceptsImages || inputImages.length >= maxInputImages) {
				return;
			}
			const items = Array.from(e.clipboardData.items);
			for (const item of items) {
				if (item.type.startsWith("image/")) {
					e.preventDefault();
					const file = item.getAsFile();
					if (file) {
						addImageFile(file);
					}
					break;
				}
			}
		},
		[acceptsImages, inputImages.length, addImageFile, maxInputImages],
	);

	// Drag-and-drop handlers
	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (acceptsImages && inputImages.length < maxInputImages) {
				setIsDragging(true);
			}
		},
		[acceptsImages, inputImages.length, maxInputImages],
	);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// Only set dragging to false if we're leaving the drop zone entirely
		if (
			dropZoneRef.current &&
			!dropZoneRef.current.contains(e.relatedTarget as Node)
		) {
			setIsDragging(false);
		}
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragging(false);
			if (!acceptsImages || inputImages.length >= maxInputImages) {
				return;
			}
			const files = Array.from(e.dataTransfer.files);
			for (const file of files) {
				if (file.type.startsWith("image/")) {
					addImageFile(file);
				}
			}
		},
		[acceptsImages, inputImages.length, addImageFile, maxInputImages],
	);

	// Reset drag state when mouse leaves the window
	useEffect(() => {
		const handleWindowDragEnd = () => setIsDragging(false);
		window.addEventListener("dragend", handleWindowDragEnd);
		return () => window.removeEventListener("dragend", handleWindowDragEnd);
	}, []);

	// Trim attached images if the selected model's per-model upload limit
	// is lower than the number of currently attached images.
	useEffect(() => {
		setInputImages((prev) =>
			prev.length > maxInputImages ? prev.slice(0, maxInputImages) : prev,
		);
	}, [maxInputImages, setInputImages]);

	const removeImage = (index: number) => {
		setInputImages((prev) => prev.filter((_, i) => i !== index));
	};

	const canGenerate = prompt.trim().length > 0 && selectedModels.length > 0;

	return (
		<div className="border-b bg-background p-4">
			<div className="max-w-4xl mx-auto space-y-3">
				<div
					ref={dropZoneRef}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					className={`rounded-md border-input border dark:bg-input/30 shadow-xs focus-within:ring-1 focus-within:ring-ring transition-colors ${
						isDragging ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
					}`}
				>
					{isDragging &&
						acceptsImages &&
						inputImages.length < maxInputImages && (
							<div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
								<ImagePlus className="h-4 w-4 mr-2" />
								Drop image here
							</div>
						)}
					{isEditModel && inputImages.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pt-3">
							{inputImages.map((img, i) => (
								<div
									key={i}
									className="relative group h-14 w-14 rounded-md border"
								>
									<img
										src={img.dataUrl}
										alt={`Input ${i + 1}`}
										className="size-full rounded-md object-cover"
									/>
									<button
										type="button"
										aria-label="Remove attachment"
										onClick={() => removeImage(i)}
										className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity hover:text-foreground"
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							))}
						</div>
					)}
					<Textarea
						ref={textareaRef}
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={handleKeyDown}
						onPaste={handlePaste}
						placeholder={
							requiresImageInput
								? "Describe how to edit the image... (paste or drop an image)"
								: isEditModel
									? "Describe the image you want to generate... (optionally paste or drop an image)"
									: "Describe the image you want to generate..."
						}
						className="min-h-[80px] max-h-[200px] resize-none border-0 bg-transparent dark:bg-transparent focus-visible:ring-0 shadow-none"
						disabled={isGenerating}
					/>
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					multiple
					className="hidden"
					onChange={handleFileSelect}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => fileInputRef.current?.click()}
						disabled={
							isGenerating ||
							!isEditModel ||
							svgSelected ||
							inputImages.length >= maxInputImages
						}
						title={
							!isEditModel
								? "Image input not supported by selected model"
								: svgSelected
									? "SVG output does not take reference images"
									: undefined
						}
					>
						<ImagePlus className="h-4 w-4 mr-1.5" />
						{inputImages.length === 0
							? "Add image"
							: `${inputImages.length}/${maxInputImages}`}
					</Button>
					{!config.usesPixelDimensions && (
						<>
							<Select
								value={imageAspectRatio}
								onValueChange={(val) => setImageAspectRatio(val as AspectRatio)}
							>
								<SelectTrigger size="sm" className="min-w-[110px]">
									<SelectValue placeholder="Aspect ratio" />
								</SelectTrigger>
								<SelectContent>
									{filteredAspectRatios.map((r) => (
										<SelectItem key={r} value={r}>
											<span className="flex items-center gap-2">
												<AspectRatioIcon ratio={r} />
												{r === "auto" ? "Auto" : r}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{!config.isReve && (
								<Select value={imageSize} onValueChange={setImageSize}>
									<SelectTrigger size="sm" className="min-w-[80px]">
										<SelectValue placeholder="Resolution" />
									</SelectTrigger>
									<SelectContent>
										{config.availableSizes.map((size) => (
											<SelectItem key={size} value={size}>
												{size}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
						</>
					)}
					{config.usesPixelDimensions && config.isGptImage && (
						<Select
							value={alibabaImageSize}
							onValueChange={setAlibabaImageSize}
						>
							<SelectTrigger size="sm" className="min-w-[130px]">
								<SelectValue placeholder="Resolution" />
							</SelectTrigger>
							<SelectContent>
								{config.availableSizes.map((size) => (
									<SelectItem key={size} value={size}>
										{size === "auto" ? "Auto" : size}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{config.usesPixelDimensions && !config.isGptImage && (
						<Select
							value={alibabaImageSize}
							onValueChange={setAlibabaImageSize}
						>
							<SelectTrigger size="sm" className="min-w-[130px]">
								<SelectValue placeholder="Image Size" />
							</SelectTrigger>
							<SelectContent>
								{config.availableSizes.map((size) => (
									<SelectItem key={size} value={size}>
										{size}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{config.supportsQuality && (
						<Select value={imageQuality} onValueChange={setImageQuality}>
							<SelectTrigger size="sm" className="min-w-[100px]">
								<SelectValue placeholder="Quality" />
							</SelectTrigger>
							<SelectContent>
								{config.availableQualities.map((q) => (
									<SelectItem key={q} value={q}>
										{q.charAt(0).toUpperCase() + q.slice(1)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{config.supportsModeration && (
						<Select value={imageModeration} onValueChange={setImageModeration}>
							<SelectTrigger size="sm" className="min-w-[150px]">
								<SelectValue placeholder="Moderation" />
							</SelectTrigger>
							<SelectContent>
								{config.availableModerations.map((m) => (
									<SelectItem key={m} value={m}>
										Moderation: {m}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{supportsSvgOutput && (
						<Select
							value={imageFormat}
							onValueChange={(val) => setImageFormat(val as ImageOutputFormat)}
						>
							<SelectTrigger
								size="sm"
								className="min-w-[90px]"
								aria-label="Output format"
							>
								<SelectValue placeholder="Format" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="image">Image</SelectItem>
								<SelectItem value="svg">SVG</SelectItem>
							</SelectContent>
						</Select>
					)}
					<Select
						value={String(imageCount)}
						onValueChange={(val) => setImageCount(Number(val) as 1 | 2 | 3 | 4)}
						disabled={svgSelected}
					>
						<SelectTrigger
							size="sm"
							className="min-w-[90px]"
							title={svgSelected ? "SVG output returns one image" : undefined}
						>
							<SelectValue placeholder="Count" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1">1 image</SelectItem>
							<SelectItem value="2">2 images</SelectItem>
							<SelectItem value="3">3 images</SelectItem>
							<SelectItem value="4">4 images</SelectItem>
						</SelectContent>
					</Select>
					{supportsFlex && (
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										type="button"
										variant={serviceTier === "flex" ? "secondary" : "outline"}
										size="sm"
										aria-pressed={serviceTier === "flex"}
										disabled={isGenerating}
										onClick={() =>
											setServiceTier(
												serviceTier === "flex" ? "default" : "flex",
											)
										}
									>
										<Zap
											className={cn(
												"h-4 w-4 mr-1.5",
												serviceTier === "flex" &&
													"text-lounge-gold fill-lounge-gold",
											)}
										/>
										Flex
									</Button>
								</TooltipTrigger>
								<TooltipContent className="max-w-xs">
									Flex processing costs about half as much, but runs slower and
									is best-effort under load. Applies to the selected models that
									support it.
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					)}
					<div className="flex-1" />
					<Button
						onClick={onGenerate}
						disabled={isGenerating || !canGenerate}
						className="ml-auto min-w-[120px]"
					>
						{isGenerating ? (
							<>
								<Loader2 className="h-4 w-4 animate-spin mr-2" />
								Generating...
							</>
						) : (
							<>
								<Sparkles className="h-4 w-4 mr-2" />
								Generate
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
