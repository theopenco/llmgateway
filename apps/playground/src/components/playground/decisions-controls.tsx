"use client";

import {
	ChevronDown,
	ChevronUp,
	ImagePlus,
	Loader2,
	Plus,
	Scale,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
	TooltipTrigger,
} from "@/components/ui/tooltip";
import {
	DECISION_QUESTION_TYPE_LABELS,
	MAX_DECISION_CHOICES,
	MAX_DECISION_INPUT_IMAGES,
	MAX_DECISION_LEVELS,
	MAX_DECISION_QUESTIONS,
	convertDecisionQuestion,
	createDecisionQuestion,
	decisionScenarios,
	fromQuestionDrafts,
	isDecisionImageDataUrl,
	validateDecisionQuestions,
} from "@/lib/decisions";
import { cn } from "@/lib/utils";

import type {
	DecisionInputImage,
	DecisionQuestionDraft,
	DecisionQuestionType,
	DecisionScenario,
} from "@/lib/decisions";
import type { Dispatch, SetStateAction } from "react";

const QUESTION_TYPES: DecisionQuestionType[] = ["predicate", "choice", "score"];

// Files over this are refused before they are read; smaller ones are still
// downscaled below so the data URL stays well under the API's limit.
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1536;

// Decision models only need enough pixels to judge the picture, and the
// run (images included) is stored in history, so attachments are resized
// to at most 1536px on the long edge and re-encoded as JPEG (PNG when the
// source has transparency).
async function downscaleImage(file: File): Promise<DecisionInputImage> {
	const bitmap = await createImageBitmap(file);
	const scale = Math.min(
		1,
		MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height),
	);
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Could not read the image");
	}
	context.drawImage(bitmap, 0, 0, width, height);
	bitmap.close();
	if (hasTransparency(context, width, height)) {
		const png = canvas.toDataURL("image/png");
		if (isDecisionImageDataUrl(png)) {
			return { dataUrl: png, mediaType: "image/png" };
		}
	}
	// Opaque pictures (and transparent ones too big as PNG) go out as JPEG on
	// a white background, which keeps even a 1536px photo well under the cap.
	context.globalCompositeOperation = "destination-over";
	context.fillStyle = "#ffffff";
	context.fillRect(0, 0, width, height);
	const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
	if (!isDecisionImageDataUrl(dataUrl)) {
		throw new Error("The image is too large even after resizing");
	}
	return { dataUrl, mediaType: "image/jpeg" };
}

// Samples the alpha channel on a coarse grid; good enough to tell a logo
// with a transparent background from a photo.
function hasTransparency(
	context: CanvasRenderingContext2D,
	width: number,
	height: number,
): boolean {
	const { data } = context.getImageData(0, 0, width, height);
	const step = Math.max(1, Math.floor((width * height) / 20_000)) * 4;
	for (let offset = 3; offset < data.length; offset += step) {
		if (data[offset]! < 250) {
			return true;
		}
	}
	return false;
}

const isApplePlatform =
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.platform);

interface DecisionsControlsProps {
	input: string;
	setInput: (value: string) => void;
	inputImages: DecisionInputImage[];
	setInputImages: Dispatch<SetStateAction<DecisionInputImage[]>>;
	acceptsImages: boolean;
	questions: DecisionQuestionDraft[];
	setQuestions: Dispatch<SetStateAction<DecisionQuestionDraft[]>>;
	// Changes whenever the editor is filled from a preset or a history item.
	editorRevision: number;
	selectedModels: string[];
	isGenerating: boolean;
	// True while a history run's image payloads are still loading into the
	// editor, so edits are not typed into fields about to be replaced.
	isRestoring?: boolean;
	onGenerate: () => void;
	onLoadScenario: (scenario: DecisionScenario) => void;
}

function OptionRow({
	value,
	description,
	valuePlaceholder,
	questionNumber,
	onChange,
	onRemove,
	canRemove,
	disabled,
}: {
	value: string;
	description: string;
	valuePlaceholder: string;
	questionNumber: number;
	onChange: (value: string, description: string) => void;
	onRemove: () => void;
	canRemove: boolean;
	disabled: boolean;
}) {
	const label = `Question ${questionNumber} ${valuePlaceholder.toLowerCase()}`;
	return (
		<div className="flex items-center gap-1.5">
			<Input
				value={value}
				onChange={(e) => onChange(e.target.value, description)}
				placeholder={valuePlaceholder}
				className="h-8 w-36 shrink-0 text-xs"
				disabled={disabled}
				aria-label={label}
			/>
			<Input
				value={description}
				onChange={(e) => onChange(value, e.target.value)}
				placeholder="Description (optional)"
				className="h-8 min-w-0 flex-1 text-xs"
				disabled={disabled}
				aria-label={`${label} description`}
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="h-8 w-8 shrink-0"
				onClick={onRemove}
				disabled={disabled || !canRemove}
				aria-label={`Remove ${label}`}
			>
				<X className="h-3.5 w-3.5" />
			</Button>
		</div>
	);
}

function QuestionEditor({
	question,
	index,
	count,
	disabled,
	onChange,
	onRemove,
	onMove,
}: {
	question: DecisionQuestionDraft;
	index: number;
	count: number;
	disabled: boolean;
	onChange: (next: DecisionQuestionDraft) => void;
	onRemove: () => void;
	onMove: (direction: -1 | 1) => void;
}) {
	const update = (patch: Partial<DecisionQuestionDraft>) =>
		onChange({ ...question, ...patch } as DecisionQuestionDraft);

	return (
		<div className="rounded-md border bg-background p-3 space-y-2">
			<div className="flex flex-wrap items-center gap-2">
				<span className="w-5 shrink-0 text-xs font-mono text-muted-foreground">
					{index + 1}.
				</span>
				<Select
					value={question.type}
					onValueChange={(value) =>
						onChange({
							...convertDecisionQuestion(
								question,
								value as DecisionQuestionType,
							),
							id: question.id,
						})
					}
					disabled={disabled}
				>
					<SelectTrigger
						size="sm"
						className="w-[120px]"
						aria-label={`Question ${index + 1} type`}
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{QUESTION_TYPES.map((type) => (
							<SelectItem key={type} value={type}>
								{DECISION_QUESTION_TYPE_LABELS[type].label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Input
					value={question.name}
					onChange={(e) =>
						update({ name: e.target.value.replace(/\s+/g, "_") })
					}
					placeholder={`name (optional, e.g. q${index + 1})`}
					className="h-8 w-40 font-mono text-xs"
					disabled={disabled}
					aria-label={`Question ${index + 1} name`}
				/>
				<div className="ml-auto flex items-center">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => onMove(-1)}
						disabled={disabled || index === 0}
						aria-label={`Move question ${index + 1} up`}
					>
						<ChevronUp className="h-3.5 w-3.5" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7"
						onClick={() => onMove(1)}
						disabled={disabled || index === count - 1}
						aria-label={`Move question ${index + 1} down`}
					>
						<ChevronDown className="h-3.5 w-3.5" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						className="h-7 w-7 text-muted-foreground hover:text-destructive"
						onClick={onRemove}
						disabled={disabled}
						aria-label={`Remove question ${index + 1}`}
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				</div>
			</div>
			<Input
				value={question.instructions}
				onChange={(e) => update({ instructions: e.target.value })}
				placeholder={
					question.type === "predicate"
						? "Does the message convey urgency?"
						: question.type === "choice"
							? "Which team should handle this?"
							: "Rate the operational impact."
				}
				className="h-8 text-sm"
				disabled={disabled}
				aria-label={`Question ${index + 1} instructions`}
			/>
			{question.type === "choice" && (
				<div className="space-y-1.5 pl-7">
					{question.choices.map((choice, choiceIndex) => (
						<OptionRow
							key={choiceIndex}
							value={choice.value}
							description={choice.description ?? ""}
							valuePlaceholder={`Option ${choiceIndex + 1}`}
							questionNumber={index + 1}
							disabled={disabled}
							canRemove={question.choices.length > 2}
							onChange={(value, description) =>
								update({
									choices: question.choices.map((c, i) =>
										i === choiceIndex ? { value, description } : c,
									),
								})
							}
							onRemove={() =>
								update({
									choices: question.choices.filter((_, i) => i !== choiceIndex),
								})
							}
						/>
					))}
					{question.choices.length < MAX_DECISION_CHOICES && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs text-muted-foreground"
							disabled={disabled}
							onClick={() =>
								update({ choices: [...question.choices, { value: "" }] })
							}
						>
							<Plus className="mr-1 h-3.5 w-3.5" />
							Add option
						</Button>
					)}
				</div>
			)}
			{question.type === "score" && (
				<div className="space-y-1.5 pl-7">
					<p className="text-[11px] text-muted-foreground">
						Levels, lowest first.
					</p>
					{question.levels.map((level, levelIndex) => (
						<OptionRow
							key={levelIndex}
							value={level.label}
							description={level.description ?? ""}
							valuePlaceholder={`Level ${levelIndex + 1}`}
							questionNumber={index + 1}
							disabled={disabled}
							canRemove={question.levels.length > 2}
							onChange={(label, description) =>
								update({
									levels: question.levels.map((l, i) =>
										i === levelIndex ? { label, description } : l,
									),
								})
							}
							onRemove={() =>
								update({
									levels: question.levels.filter((_, i) => i !== levelIndex),
								})
							}
						/>
					))}
					{question.levels.length < MAX_DECISION_LEVELS && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 px-2 text-xs text-muted-foreground"
							disabled={disabled}
							onClick={() =>
								update({ levels: [...question.levels, { label: "" }] })
							}
						>
							<Plus className="mr-1 h-3.5 w-3.5" />
							Add level
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

export function DecisionsControls({
	input,
	setInput,
	inputImages,
	setInputImages,
	acceptsImages,
	questions,
	setQuestions,
	editorRevision,
	selectedModels,
	isGenerating,
	isRestoring = false,
	onGenerate,
	onLoadScenario,
}: DecisionsControlsProps) {
	const disabled = isGenerating || isRestoring;
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [questionsOpen, setQuestionsOpen] = useState(true);

	// Fold the editor away while a run is in flight so the answers land in
	// view instead of below three question cards.
	useEffect(() => {
		if (isGenerating) {
			setQuestionsOpen(false);
		}
	}, [isGenerating]);

	// ...and unfold it again whenever something fills the editor.
	useEffect(() => {
		if (editorRevision > 0) {
			setQuestionsOpen(true);
		}
	}, [editorRevision]);

	const questionError = validateDecisionQuestions(
		fromQuestionDrafts(questions),
	);
	const hasInput = input.trim().length > 0 || inputImages.length > 0;
	const canGenerate =
		hasInput && selectedModels.length > 0 && questionError === null;

	// Decoding is async; a result that lands after the editor was refilled
	// from a preset or a history run belongs to the previous content.
	const editorRevisionRef = useRef(editorRevision);
	editorRevisionRef.current = editorRevision;

	const addImage = useCallback(
		async (file: File) => {
			if (!file.type.startsWith("image/")) {
				return;
			}
			if (file.size > MAX_IMAGE_BYTES) {
				toast.error("Images must be 20 MB or smaller");
				return;
			}
			const revision = editorRevisionRef.current;
			try {
				const image = await downscaleImage(file);
				if (editorRevisionRef.current !== revision) {
					return;
				}
				setInputImages((prev) =>
					prev.length >= MAX_DECISION_INPUT_IMAGES ? prev : [...prev, image],
				);
			} catch (error) {
				toast.error(
					error instanceof Error ? error.message : "Could not read the image",
				);
			}
		},
		[setInputImages],
	);

	const handleFiles = useCallback(
		(files: FileList | File[] | null) => {
			if (!files) {
				return;
			}
			for (const file of Array.from(files)) {
				void addImage(file);
			}
		},
		[addImage],
	);

	// Attached to the whole editor so the shortcut works from the question
	// inputs as well as the textarea.
	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			if (!disabled && canGenerate) {
				onGenerate();
			}
		}
	};

	const addQuestion = (type: DecisionQuestionType) => {
		setQuestions((prev) =>
			prev.length >= MAX_DECISION_QUESTIONS
				? prev
				: [
						...prev,
						{ ...createDecisionQuestion(type), id: crypto.randomUUID() },
					],
		);
		setQuestionsOpen(true);
	};

	return (
		<div className="border-b bg-background p-4" onKeyDown={handleKeyDown}>
			<div className="mx-auto max-w-4xl space-y-3">
				<div
					className={cn(
						"rounded-md border border-input shadow-xs transition-colors focus-within:ring-1 focus-within:ring-ring dark:bg-input/30",
						isDragging && "border-primary ring-1 ring-primary",
					)}
					onDragOver={(e) => {
						if (!acceptsImages || disabled) {
							return;
						}
						e.preventDefault();
						setIsDragging(true);
					}}
					onDragLeave={() => setIsDragging(false)}
					onDrop={(e) => {
						if (!acceptsImages || disabled) {
							return;
						}
						e.preventDefault();
						setIsDragging(false);
						handleFiles(e.dataTransfer.files);
					}}
				>
					<Textarea
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onPaste={(e) => {
							if (!acceptsImages || disabled) {
								return;
							}
							const files = Array.from(e.clipboardData.files);
							if (files.length > 0) {
								e.preventDefault();
								handleFiles(files);
							}
						}}
						placeholder="Paste the text to decide on: a support ticket, a comment, a lead, a review..."
						className="max-h-[240px] min-h-[96px] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
						disabled={disabled}
						aria-label="Input to decide on"
					/>
					{inputImages.length > 0 && (
						<div className="flex flex-wrap gap-2 px-3 pb-3">
							{inputImages.map((image, index) => (
								<div key={index} className="group relative">
									<img
										src={image.dataUrl}
										alt={`Input image ${index + 1}`}
										className="h-16 w-16 rounded-md border object-cover"
									/>
									<button
										type="button"
										aria-label={`Remove image ${index + 1}`}
										className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
										onClick={() =>
											setInputImages((prev) =>
												prev.filter((_, i) => i !== index),
											)
										}
										disabled={disabled}
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							))}
						</div>
					)}
				</div>
				<input
					ref={fileInputRef}
					type="file"
					accept="image/*"
					multiple
					className="hidden"
					onChange={(e) => {
						handleFiles(e.target.files);
						e.target.value = "";
					}}
				/>

				<div className="flex flex-wrap items-center gap-2">
					{acceptsImages && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => fileInputRef.current?.click()}
									disabled={
										disabled || inputImages.length >= MAX_DECISION_INPUT_IMAGES
									}
								>
									<ImagePlus className="mr-1.5 h-4 w-4" />
									{inputImages.length > 0
										? `${inputImages.length}/${MAX_DECISION_INPUT_IMAGES} images`
										: "Add images"}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								Decide on photos too: paste, drop, or pick up to{" "}
								{MAX_DECISION_INPUT_IMAGES} images.
							</TooltipContent>
						</Tooltip>
					)}
					<span className="hidden text-xs text-muted-foreground sm:inline">
						{isApplePlatform ? "⌘↵" : "Ctrl+↵"} to run
					</span>
					<div className="flex-1" />
					<Button
						onClick={onGenerate}
						disabled={disabled || !canGenerate}
						className="min-w-[120px]"
					>
						{isGenerating ? (
							<>
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Deciding...
							</>
						) : (
							<>
								<Scale className="mr-2 h-4 w-4" />
								Decide
							</>
						)}
					</Button>
				</div>

				<div className="rounded-md border">
					<button
						type="button"
						className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
						onClick={() => setQuestionsOpen((value) => !value)}
						aria-expanded={questionsOpen}
					>
						<span className="font-medium">
							Questions{" "}
							<span className="font-normal text-muted-foreground">
								({questions.length}/{MAX_DECISION_QUESTIONS})
							</span>
						</span>
						{questionError && questions.length > 0 && (
							<span className="truncate text-xs text-destructive">
								{questionError}
							</span>
						)}
						{questionsOpen ? (
							<ChevronUp className="ml-auto h-4 w-4 text-muted-foreground" />
						) : (
							<ChevronDown className="ml-auto h-4 w-4 text-muted-foreground" />
						)}
					</button>
					{questionsOpen && (
						<div className="space-y-2 border-t p-3">
							{questions.length === 0 && (
								<p className="text-xs text-muted-foreground">
									Add a question for the model to answer about the input.
								</p>
							)}
							{questions.map((question, index) => (
								<QuestionEditor
									key={question.id}
									question={question}
									index={index}
									count={questions.length}
									disabled={disabled}
									onChange={(next) =>
										setQuestions((prev) =>
											prev.map((q) => (q.id === question.id ? next : q)),
										)
									}
									onRemove={() =>
										setQuestions((prev) =>
											prev.filter((q) => q.id !== question.id),
										)
									}
									onMove={(direction) =>
										setQuestions((prev) => {
											const from = prev.findIndex((q) => q.id === question.id);
											const to = from + direction;
											if (from < 0 || to < 0 || to >= prev.length) {
												return prev;
											}
											const next = [...prev];
											const [moved] = next.splice(from, 1);
											next.splice(to, 0, moved!);
											return next;
										})
									}
								/>
							))}
							<div className="flex flex-wrap items-center gap-1.5 pt-1">
								{QUESTION_TYPES.map((type) => (
									<Tooltip key={type}>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="h-7 text-xs"
												disabled={
													disabled || questions.length >= MAX_DECISION_QUESTIONS
												}
												onClick={() => addQuestion(type)}
											>
												<Plus className="mr-1 h-3.5 w-3.5" />
												{DECISION_QUESTION_TYPE_LABELS[type].label}
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											{DECISION_QUESTION_TYPE_LABELS[type].description}
										</TooltipContent>
									</Tooltip>
								))}
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="ml-auto h-7 text-xs text-muted-foreground"
											disabled={disabled}
										>
											Load an example
											<ChevronDown className="ml-1 h-3.5 w-3.5" />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-56">
										{decisionScenarios.map((scenario) => (
											<DropdownMenuItem
												key={scenario.label}
												onClick={() => onLoadScenario(scenario)}
											>
												{scenario.label}
											</DropdownMenuItem>
										))}
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
