"use client";

import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { type Dispatch, type SetStateAction, useRef } from "react";

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
import { getModelImageConfig } from "@/lib/image-gen";

import type { AspectRatio } from "@/lib/image-gen";

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
	imageCount: 1 | 2 | 3 | 4;
	setImageCount: (value: 1 | 2 | 3 | 4) => void;
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
	imageCount,
	setImageCount,
	isGenerating,
	onGenerate,
	isEditModel,
	requiresImageInput,
	inputImages,
	setInputImages,
}: ImageControlsProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Derive config from first selected model (settings apply globally)
	const primaryModel = selectedModels[0] ?? "";
	const config = getModelImageConfig(primaryModel);

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
			if (!file.type.startsWith("image/")) {
				continue;
			}
			if (inputImages.length >= 1) {
				break;
			}
			const reader = new FileReader();
			reader.onload = () => {
				setInputImages((prev) => {
					if (prev.length >= 1) {
						return prev;
					}
					return [
						...prev,
						{ dataUrl: reader.result as string, mediaType: file.type },
					];
				});
			};
			reader.readAsDataURL(file);
		}
		// Reset input so same file can be re-selected
		e.target.value = "";
	};

	const removeImage = (index: number) => {
		setInputImages((prev) => prev.filter((_, i) => i !== index));
	};

	const canGenerate = prompt.trim().length > 0 && selectedModels.length > 0;

	return (
		<div className="border-b bg-background p-4">
			<div className="max-w-4xl mx-auto space-y-3">
				<div className="rounded-md border-input border dark:bg-input/30 shadow-xs focus-within:ring-1 focus-within:ring-ring">
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
						placeholder={
							isEditModel
								? "Describe how to edit the image..."
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
					className="hidden"
					onChange={handleFileSelect}
				/>
				<div className="flex flex-wrap items-center gap-2">
					{isEditModel && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => fileInputRef.current?.click()}
							disabled={isGenerating || inputImages.length >= 1}
						>
							<ImagePlus className="h-4 w-4 mr-1.5" />
							{inputImages.length === 0
								? "Add image"
								: `${inputImages.length}/1`}
						</Button>
					)}
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
									{aspectRatios.map((r) => (
										<SelectItem key={r} value={r}>
											<span className="flex items-center gap-2">
												<AspectRatioIcon ratio={r} />
												{r === "auto" ? "Auto" : r}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
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
						</>
					)}
					{config.usesPixelDimensions && (
						<Select
							value={alibabaImageSize}
							onValueChange={setAlibabaImageSize}
						>
							<SelectTrigger size="sm" className="min-w-[130px]">
								<SelectValue placeholder="Image Size" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="1024x1024">1024x1024</SelectItem>
								<SelectItem value="720x1280">720x1280</SelectItem>
								<SelectItem value="1280x720">1280x720</SelectItem>
								<SelectItem value="1024x1536">1024x1536</SelectItem>
								<SelectItem value="1536x1024">1536x1024</SelectItem>
								<SelectItem value="2048x1024">2048x1024</SelectItem>
								<SelectItem value="1024x2048">1024x2048</SelectItem>
							</SelectContent>
						</Select>
					)}
					<Select
						value={String(imageCount)}
						onValueChange={(val) => setImageCount(Number(val) as 1 | 2 | 3 | 4)}
					>
						<SelectTrigger size="sm" className="min-w-[90px]">
							<SelectValue placeholder="Count" />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="1">1 image</SelectItem>
							<SelectItem value="2">2 images</SelectItem>
							<SelectItem value="3">3 images</SelectItem>
							<SelectItem value="4">4 images</SelectItem>
						</SelectContent>
					</Select>
					<div className="flex-1" />
					<Button
						onClick={onGenerate}
						disabled={isGenerating || !canGenerate}
						className="min-w-[120px]"
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
