"use client";

import {
	Film,
	ImagePlus,
	Loader2,
	Music,
	Plus,
	Sparkles,
	X,
} from "lucide-react";
import {
	type Dispatch,
	type SetStateAction,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	getVideoDurations,
	getVideoSizeLabel,
	getVideoSizes,
	type VideoDuration,
	type VideoFrameInputs,
	type VideoInputImage,
	type VideoSize,
} from "@/lib/video-gen";

interface VideoControlsProps {
	prompt: string;
	setPrompt: (prompt: string) => void;
	selectedModels: string[];
	videoSize: VideoSize;
	setVideoSize: (value: VideoSize) => void;
	videoDuration: VideoDuration;
	setVideoDuration: (value: VideoDuration) => void;
	audioEnabled: boolean;
	setAudioEnabled: (value: boolean) => void;
	audioToggleDisabled: boolean;
	canUseFrameInputs: boolean;
	canUseReferenceInputs: boolean;
	canUseReferenceVideoInputs: boolean;
	canUseReferenceAudioInputs: boolean;
	frameInputs: VideoFrameInputs;
	setFrameInputs: Dispatch<SetStateAction<VideoFrameInputs>>;
	referenceImages: VideoInputImage[];
	setReferenceImages: Dispatch<SetStateAction<VideoInputImage[]>>;
	referenceVideos: string[];
	setReferenceVideos: Dispatch<SetStateAction<string[]>>;
	referenceAudios: string[];
	setReferenceAudios: Dispatch<SetStateAction<string[]>>;
	supportedVideoSizes: VideoSize[];
	supportedVideoDurations: VideoDuration[];
	isGenerating: boolean;
	onGenerate: () => void;
}

type UploadTarget = "frame-start" | "frame-end" | "reference";

export function VideoControls({
	prompt,
	setPrompt,
	selectedModels,
	videoSize,
	setVideoSize,
	videoDuration,
	setVideoDuration,
	audioEnabled,
	setAudioEnabled,
	audioToggleDisabled,
	canUseFrameInputs,
	canUseReferenceInputs,
	canUseReferenceVideoInputs,
	canUseReferenceAudioInputs,
	frameInputs,
	setFrameInputs,
	referenceImages,
	setReferenceImages,
	referenceVideos,
	setReferenceVideos,
	referenceAudios,
	setReferenceAudios,
	supportedVideoSizes,
	supportedVideoDurations,
	isGenerating,
	onGenerate,
}: VideoControlsProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const dropZoneRef = useRef<HTMLDivElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [uploadTarget, setUploadTarget] = useState<UploadTarget>("frame-start");
	const [referenceVideoDraft, setReferenceVideoDraft] = useState("");

	const addReferenceVideo = useCallback(() => {
		const url = referenceVideoDraft.trim();
		if (!url || !/^https:\/\//i.test(url)) {
			return;
		}
		setFrameInputs({ start: null, end: null });
		setReferenceVideos((prev) =>
			prev.length >= 3 || prev.includes(url) ? prev : [...prev, url],
		);
		setReferenceVideoDraft("");
	}, [referenceVideoDraft, setFrameInputs, setReferenceVideos]);

	const removeReferenceVideo = useCallback(
		(index: number) => {
			setReferenceVideos((prev) => prev.filter((_, i) => i !== index));
		},
		[setReferenceVideos],
	);

	const [referenceAudioDraft, setReferenceAudioDraft] = useState("");

	const addReferenceAudio = useCallback(() => {
		const url = referenceAudioDraft.trim();
		if (!url || !/^https:\/\//i.test(url)) {
			return;
		}
		setFrameInputs({ start: null, end: null });
		setReferenceAudios((prev) =>
			prev.length >= 3 || prev.includes(url) ? prev : [...prev, url],
		);
		setReferenceAudioDraft("");
	}, [referenceAudioDraft, setFrameInputs, setReferenceAudios]);

	const removeReferenceAudio = useCallback(
		(index: number) => {
			setReferenceAudios((prev) => prev.filter((_, i) => i !== index));
		},
		[setReferenceAudios],
	);

	const canGenerate = prompt.trim().length > 0 && selectedModels.length > 0;
	const canAcceptInput = canUseFrameInputs || canUseReferenceInputs;
	const defaultUploadTarget: UploadTarget = !canUseReferenceInputs
		? frameInputs.start
			? "frame-end"
			: "frame-start"
		: !canUseFrameInputs ||
			  uploadTarget === "reference" ||
			  referenceImages.length > 0
			? "reference"
			: frameInputs.start
				? "frame-end"
				: "frame-start";

	const addImageFile = useCallback(
		(file: File, explicitTarget?: UploadTarget) => {
			if (!canAcceptInput || !file.type.startsWith("image/")) {
				return;
			}

			const target = explicitTarget ?? defaultUploadTarget;

			if (
				(target === "frame-start" || target === "frame-end") &&
				!canUseFrameInputs
			) {
				return;
			}

			if (target === "reference" && !canUseReferenceInputs) {
				return;
			}

			const reader = new FileReader();
			reader.onload = () => {
				const nextImage = {
					dataUrl: String(reader.result ?? ""),
					mediaType: file.type,
				};

				if (target === "frame-start") {
					setReferenceImages([]);
					setReferenceVideos([]);
					setReferenceAudios([]);
					setFrameInputs((prev) => ({
						...prev,
						start: nextImage,
					}));
					return;
				}

				if (target === "frame-end") {
					setReferenceImages([]);
					setReferenceVideos([]);
					setReferenceAudios([]);
					setFrameInputs((prev) => ({
						...prev,
						end: nextImage,
					}));
					return;
				}

				setFrameInputs({
					start: null,
					end: null,
				});
				setReferenceImages((prev) => {
					if (prev.length >= 3) {
						return prev;
					}

					return [...prev, nextImage];
				});
			};
			reader.readAsDataURL(file);
		},
		[
			canAcceptInput,
			canUseFrameInputs,
			canUseReferenceInputs,
			defaultUploadTarget,
			setFrameInputs,
			setReferenceImages,
			setReferenceVideos,
			setReferenceAudios,
		],
	);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (canGenerate && !isGenerating) {
				onGenerate();
			}
		}
	};

	const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(e.target.files ?? []);

		for (const file of files) {
			if (uploadTarget === "reference" && referenceImages.length >= 3) {
				break;
			}
			addImageFile(file, uploadTarget);
			if (uploadTarget !== "reference") {
				break;
			}
		}

		e.target.value = "";
	};

	const handlePaste = useCallback(
		(e: React.ClipboardEvent) => {
			if (!canAcceptInput) {
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
		[addImageFile, canAcceptInput],
	);

	const handleDragOver = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			if (canAcceptInput) {
				setIsDragging(true);
			}
		},
		[canAcceptInput],
	);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
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
			if (!canAcceptInput) {
				return;
			}

			const files = Array.from(e.dataTransfer.files);
			for (const file of files) {
				if (file.type.startsWith("image/")) {
					addImageFile(file, defaultUploadTarget);
					if (defaultUploadTarget !== "reference") {
						break;
					}
				}
			}
		},
		[addImageFile, canAcceptInput, defaultUploadTarget],
	);

	useEffect(() => {
		const handleWindowDragEnd = () => setIsDragging(false);
		window.addEventListener("dragend", handleWindowDragEnd);
		return () => window.removeEventListener("dragend", handleWindowDragEnd);
	}, []);

	const removeFrameImage = (target: "start" | "end") => {
		setFrameInputs((prev) => ({
			...prev,
			[target]: null,
		}));
	};

	const removeReferenceImage = (index: number) => {
		setReferenceImages((prev) => prev.filter((_, i) => i !== index));
	};

	const openFilePicker = (target: UploadTarget) => {
		setUploadTarget(target);
		fileInputRef.current?.click();
	};

	return (
		<div className="border-b bg-background p-4">
			<div className="max-w-4xl mx-auto space-y-3">
				<div
					ref={dropZoneRef}
					onDragOver={handleDragOver}
					onDragLeave={handleDragLeave}
					onDrop={handleDrop}
					onPaste={handlePaste}
					className={`rounded-md border-input border dark:bg-input/30 shadow-xs focus-within:ring-1 focus-within:ring-ring transition-colors ${
						isDragging ? "border-primary bg-primary/5 ring-1 ring-primary" : ""
					}`}
				>
					{isDragging && canAcceptInput && (
						<div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
							<ImagePlus className="mr-2 h-4 w-4" />
							Drop image here
						</div>
					)}
					{(frameInputs.start ?? frameInputs.end) && (
						<div className="flex flex-wrap gap-2 px-3 pt-3">
							{[
								{
									key: "start" as const,
									label: "First",
									image: frameInputs.start,
								},
								{
									key: "end" as const,
									label: "Last",
									image: frameInputs.end,
								},
							].map((item) => {
								if (!item.image) {
									return null;
								}

								return (
									<div key={item.key} className="space-y-1">
										<div className="px-1 text-xs text-muted-foreground">
											{item.label} frame
										</div>
										<div className="group relative h-14 w-14 rounded-md border">
											<img
												src={item.image.dataUrl}
												alt={`${item.label} frame`}
												className="size-full rounded-md object-cover"
											/>
											<button
												type="button"
												aria-label={`Remove ${item.label} frame`}
												onClick={() => removeFrameImage(item.key)}
												className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
											>
												<X className="h-3 w-3" />
											</button>
										</div>
									</div>
								);
							})}
						</div>
					)}
					{referenceImages.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pt-3">
							{referenceImages.map((image, index) => (
								<div key={`${image.dataUrl}-${index}`} className="space-y-1">
									<div className="px-1 text-xs text-muted-foreground">
										Reference {index + 1}
									</div>
									<div className="group relative h-14 w-14 rounded-md border">
										<img
											src={image.dataUrl}
											alt={`Reference ${index + 1}`}
											className="size-full rounded-md object-cover"
										/>
										<button
											type="button"
											aria-label="Remove reference image"
											onClick={() => removeReferenceImage(index)}
											className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
										>
											<X className="h-3 w-3" />
										</button>
									</div>
								</div>
							))}
						</div>
					)}
					{referenceVideos.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pt-3">
							{referenceVideos.map((url, index) => (
								<div
									key={`${url}-${index}`}
									className="group relative flex max-w-[220px] items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-6 text-xs"
									title={url}
								>
									<Film className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<span className="truncate">Reference video {index + 1}</span>
									<button
										type="button"
										aria-label="Remove reference video"
										onClick={() => removeReferenceVideo(index)}
										className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							))}
						</div>
					)}
					{referenceAudios.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pt-3">
							{referenceAudios.map((url, index) => (
								<div
									key={`${url}-${index}`}
									className="group relative flex max-w-[220px] items-center gap-1.5 rounded-md border bg-muted/40 py-1 pl-2 pr-6 text-xs"
									title={url}
								>
									<Music className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<span className="truncate">Reference audio {index + 1}</span>
									<button
										type="button"
										aria-label="Remove reference audio"
										onClick={() => removeReferenceAudio(index)}
										className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
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
						placeholder="Describe the video you want to generate... (optionally paste or drop a first/last frame or reference image)"
						className="min-h-[80px] max-h-[200px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
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
					<Button
						variant="outline"
						size="sm"
						onClick={() => openFilePicker("frame-start")}
						disabled={isGenerating || !canUseFrameInputs}
						title={
							!canUseFrameInputs
								? "Frame input not supported by selected model"
								: undefined
						}
					>
						<ImagePlus className="mr-1.5 h-4 w-4" />
						{frameInputs.start ? "Replace first" : "First frame"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => openFilePicker("frame-end")}
						disabled={isGenerating || !canUseFrameInputs}
						title={
							!canUseFrameInputs
								? "Frame input not supported by selected model"
								: undefined
						}
					>
						<ImagePlus className="mr-1.5 h-4 w-4" />
						{frameInputs.end ? "Replace last" : "Last frame"}
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => openFilePicker("reference")}
						disabled={
							isGenerating ||
							!canUseReferenceInputs ||
							referenceImages.length >= 3
						}
						title={
							!canUseReferenceInputs
								? "Reference images not supported by selected model"
								: undefined
						}
					>
						<ImagePlus className="mr-1.5 h-4 w-4" />
						{referenceImages.length === 0
							? "Reference"
							: `${referenceImages.length}/3 refs`}
					</Button>
					{canUseReferenceVideoInputs && (
						<div className="flex items-center gap-1.5">
							<Input
								value={referenceVideoDraft}
								onChange={(e) => setReferenceVideoDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										addReferenceVideo();
									}
								}}
								placeholder="Reference video URL (https://)"
								disabled={isGenerating || referenceVideos.length >= 3}
								className="h-8 w-[220px] text-sm"
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={addReferenceVideo}
								disabled={
									isGenerating ||
									referenceVideos.length >= 3 ||
									!/^https:\/\//i.test(referenceVideoDraft.trim())
								}
								title="Add an HTTPS reference video URL"
							>
								<Plus className="mr-1.5 h-4 w-4" />
								{referenceVideos.length === 0
									? "Video"
									: `${referenceVideos.length}/3 videos`}
							</Button>
						</div>
					)}
					{canUseReferenceAudioInputs && (
						<div className="flex items-center gap-1.5">
							<Input
								value={referenceAudioDraft}
								onChange={(e) => setReferenceAudioDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										e.preventDefault();
										addReferenceAudio();
									}
								}}
								placeholder="Reference audio URL (https://)"
								disabled={isGenerating || referenceAudios.length >= 3}
								className="h-8 w-[220px] text-sm"
							/>
							<Button
								variant="outline"
								size="sm"
								onClick={addReferenceAudio}
								disabled={
									isGenerating ||
									referenceAudios.length >= 3 ||
									!/^https:\/\//i.test(referenceAudioDraft.trim())
								}
								title="Add an HTTPS reference audio URL"
							>
								<Plus className="mr-1.5 h-4 w-4" />
								{referenceAudios.length === 0
									? "Audio ref"
									: `${referenceAudios.length}/3 audio`}
							</Button>
						</div>
					)}
					<Select
						value={videoSize}
						onValueChange={(val) => setVideoSize(val as VideoSize)}
					>
						<SelectTrigger size="sm" className="min-w-[160px]">
							<SelectValue placeholder="Resolution" />
						</SelectTrigger>
						<SelectContent>
							{getVideoSizes().map((size) => (
								<SelectItem
									key={size}
									value={size}
									disabled={!supportedVideoSizes.includes(size)}
								>
									{getVideoSizeLabel(size)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select
						value={String(videoDuration)}
						onValueChange={(val) =>
							setVideoDuration(Number(val) as VideoDuration)
						}
					>
						<SelectTrigger size="sm" className="min-w-[100px]">
							<SelectValue placeholder="Duration" />
						</SelectTrigger>
						<SelectContent>
							{getVideoDurations().map((duration) => (
								<SelectItem
									key={duration}
									value={String(duration)}
									disabled={!supportedVideoDurations.includes(duration)}
								>
									{duration} seconds
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<label
						className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm"
						title={
							audioToggleDisabled && !isGenerating
								? "Silent output is only available on Google Vertex"
								: undefined
						}
					>
						<Switch
							checked={audioEnabled}
							onCheckedChange={setAudioEnabled}
							disabled={audioToggleDisabled}
						/>
						<span>Audio</span>
					</label>
					<div className="flex-1" />
					<Button
						onClick={onGenerate}
						disabled={isGenerating || !canGenerate}
						className="min-w-[120px]"
					>
						{isGenerating ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Generating...
							</>
						) : (
							<>
								<Sparkles className="mr-2 h-4 w-4" />
								Generate
							</>
						)}
					</Button>
				</div>
			</div>
		</div>
	);
}
