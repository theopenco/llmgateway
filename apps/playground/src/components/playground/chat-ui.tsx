"use client";
import {
	RefreshCcw,
	Copy,
	Brain,
	GlobeIcon,
	AlertTriangle,
	Info,
	GitFork,
	Loader2,
	ExternalLinkIcon,
	PlusIcon,
	ScrollTextIcon,
	TrendingDown,
	Undo2,
	XIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useEffect, useCallback, memo, useMemo } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Actions, Action } from "@/components/ai-elements/actions";
// import {
// 	Confirmation,
// 	ConfirmationAccepted,
// 	ConfirmationAction,
// 	ConfirmationActions,
// 	ConfirmationRejected,
// 	ConfirmationRequest,
// 	ConfirmationTitle,
// } from "@/components/ai-elements/confirmation";
import {
	Conversation,
	ConversationContent,
} from "@/components/ai-elements/conversation";
import { Image } from "@/components/ai-elements/image";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputAttachment,
	PromptInputAttachments,
	PromptInputBody,
	PromptInputButton,
	PromptInputSpeechButton,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
	PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import {
	Source,
	Sources,
	SourcesContent,
	SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";
import { AspectRatioIcon } from "@/components/playground/aspect-ratio-icon";
import { CreateSkillDialog } from "@/components/playground/create-skill-dialog";
import { Button } from "@/components/ui/button";
import { ImageZoom } from "@/components/ui/image-zoom";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSkills, type Skill } from "@/hooks/useSkills";
import { useApi } from "@/lib/fetch-client";
import {
	heroSuggestionGroups,
	sampleSuggestions,
	type HeroSuggestionGroup,
} from "@/lib/hero-suggestions";
import { GPT_IMAGE_SIZES } from "@/lib/image-gen";
import { parseImagePartToDataUrl } from "@/lib/image-utils";
import {
	parsePlaygroundMessageMetadata,
	type PlaygroundMessageMetadata,
} from "@/lib/message-metadata";
import { cn } from "@/lib/utils";

import type { UIMessage, ChatRequestOptions, ChatStatus } from "ai";

function getCaretCoordinates(
	textarea: HTMLTextAreaElement,
	position: number,
): { top: number; left: number; height: number } {
	const div = document.createElement("div");
	const style = window.getComputedStyle(textarea);
	for (const prop of [
		"font-family",
		"font-size",
		"font-weight",
		"font-style",
		"letter-spacing",
		"line-height",
		"padding-top",
		"padding-right",
		"padding-bottom",
		"padding-left",
		"border-top-width",
		"border-right-width",
		"border-bottom-width",
		"border-left-width",
		"box-sizing",
		"word-spacing",
	]) {
		div.style.setProperty(prop, style.getPropertyValue(prop));
	}
	div.style.position = "absolute";
	div.style.top = "0";
	div.style.left = "0";
	div.style.visibility = "hidden";
	div.style.whiteSpace = "pre-wrap";
	div.style.wordBreak = "break-word";
	div.style.width = `${textarea.offsetWidth}px`;
	div.style.height = "auto";
	div.appendChild(document.createTextNode(textarea.value.slice(0, position)));
	const span = document.createElement("span");
	span.textContent = "​";
	div.appendChild(span);
	div.appendChild(document.createTextNode(textarea.value.slice(position)));
	document.body.appendChild(div);
	const result = {
		top: span.offsetTop,
		left: span.offsetLeft,
		height: span.offsetHeight,
	};
	document.body.removeChild(div);
	return result;
}

interface ChatUIProps {
	messages: UIMessage[];
	supportsImages: boolean;
	supportsAudio: boolean;
	supportsImageGen: boolean;
	sendMessage: (
		message: UIMessage,
		options?: ChatRequestOptions,
	) => Promise<void>;
	selectedModel: string;
	text: string;
	setText: (text: string) => void;
	status: ChatStatus;
	stop: () => void;
	regenerate: () => void;
	reasoningEffort: "" | "minimal" | "low" | "medium" | "high";
	setReasoningEffort: (
		value: "" | "minimal" | "low" | "medium" | "high",
	) => void;
	supportsReasoning: boolean;
	imageAspectRatio:
		| "auto"
		| "1:1"
		| "9:16"
		| "16:9"
		| "3:4"
		| "4:3"
		| "3:2"
		| "2:3"
		| "5:4"
		| "4:5"
		| "21:9"
		| "1:4"
		| "4:1"
		| "1:8"
		| "8:1";
	setImageAspectRatio: (
		value:
			| "auto"
			| "1:1"
			| "9:16"
			| "16:9"
			| "3:4"
			| "4:3"
			| "3:2"
			| "2:3"
			| "5:4"
			| "4:5"
			| "21:9"
			| "1:4"
			| "4:1"
			| "1:8"
			| "8:1",
	) => void;
	imageSize: string;
	setImageSize: (value: string) => void;
	alibabaImageSize: string;
	setAlibabaImageSize: (value: string) => void;
	imageQuality: string;
	setImageQuality: (value: string) => void;
	imageCount: 1 | 2 | 3 | 4;
	setImageCount: (value: 1 | 2 | 3 | 4) => void;
	supportsWebSearch: boolean;
	webSearchEnabled: boolean;
	setWebSearchEnabled: (value: boolean) => void;
	onUserMessage?: (
		content: string,
		images?: Array<{
			type: "image_url";
			image_url: {
				url: string;
			};
		}>,
		audio?: Array<{
			type: "audio";
			url: string;
			mediaType: string;
			name?: string;
		}>,
	) => Promise<{ id: string } | undefined>;
	onEditUserMessage?: (message: UIMessage, content: string) => Promise<void>;
	isLoading?: boolean;
	error?: string | null;
	finishReason?: string | null;
	floatingInput?: boolean;
	isTemporaryChat?: boolean;
	forkChat?: () => void | Promise<void>;
	isForkingChat?: boolean;
	activeSkills?: Skill[];
	onSelectSkill?: (skill: Skill) => void;
	onRemoveSkill?: (skillId: string) => void;
	organizationId?: string;
	projectId?: string;
}

function getRandomHeroSuggestionGroups(): Record<
	HeroSuggestionGroup,
	readonly string[]
> {
	return {
		Create: sampleSuggestions(heroSuggestionGroups.Create, 5),
		Explore: sampleSuggestions(heroSuggestionGroups.Explore, 5),
		Code: sampleSuggestions(heroSuggestionGroups.Code, 5),
		"Image gen": sampleSuggestions(heroSuggestionGroups["Image gen"], 5),
	};
}

// js-combine-iterations: Extract message parts in a single pass instead of multiple filter() calls
interface ExtractedParts {
	textParts: string[];
	imageParts: any[];
	audioParts: any[];
	toolParts: any[];
	reasoningContent: string;
	sourceParts: any[];
}

function extractMessageParts(parts: any[]): ExtractedParts {
	const textParts: string[] = [];
	const imageParts: any[] = [];
	const audioParts: any[] = [];
	const toolParts: any[] = [];
	const reasoningParts: string[] = [];
	const sourceParts: any[] = [];

	for (const p of parts) {
		if (p.type === "text") {
			textParts.push(p.text);
		} else if (p.type === "reasoning") {
			reasoningParts.push(p.text);
		} else if (p.type.startsWith("tool-")) {
			// AI SDK v6 uses tool-{toolName} as the part type (e.g., "tool-fetch_weather")
			toolParts.push(p);
		} else if (p.type === "source-url") {
			sourceParts.push(p);
		} else if (
			(p.type === "image_url" && p.image_url?.url) ||
			(p.type === "file" && p.mediaType?.startsWith("image/"))
		) {
			imageParts.push(p);
		} else if (p.type === "file" && p.mediaType?.startsWith("audio/")) {
			audioParts.push(p);
		}
	}

	return {
		textParts,
		imageParts,
		audioParts,
		toolParts,
		reasoningContent: reasoningParts.join(""),
		sourceParts,
	};
}

function getFinishReasonLabel(reason: string): string {
	switch (reason) {
		case "length":
			return "Response reached the maximum token limit";
		case "content-filter":
		case "content_filter":
			return "Response was filtered by content policy";
		default:
			return `Generation stopped: ${reason}`;
	}
}

function formatTokenCount(value?: number): string {
	return value === undefined
		? "-"
		: new Intl.NumberFormat("en-US").format(value);
}

function formatCost(value?: number): string {
	if (value === undefined) {
		return "-";
	}
	if (value > 0 && value < 0.000001) {
		return "<$0.000001";
	}
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: value < 0.01 ? 6 : 2,
		maximumFractionDigits: value < 0.01 ? 6 : 4,
	}).format(value);
}

function getMessageImageGridClass(imageCount: number, alignEnd = false) {
	return cn(
		"mt-3 gap-3",
		imageCount === 1
			? "grid grid-cols-1"
			: cn(
					"flex max-w-full flex-row flex-wrap",
					alignEnd ? "justify-end" : "justify-start",
				),
		alignEnd && imageCount === 1 && "justify-items-end",
	);
}

function getUserMessageWidthClass(imageCount: number, isEditing?: boolean) {
	if (isEditing) {
		return "w-full max-w-full";
	}

	return imageCount > 1 ? "w-fit max-w-[80%] min-w-64" : "w-fit max-w-[80%]";
}

function getMessageImageClass(
	imageCount: number,
	singleImageClassName: string,
) {
	return cn(
		"border rounded-lg object-cover",
		imageCount === 1
			? singleImageClassName
			: "size-24 aspect-square sm:size-28",
	);
}

function MessageMetadataPopover({
	metadata,
	createdAt,
	organizationId: currentOrgId,
	projectId: currentProjectId,
}: {
	metadata: PlaygroundMessageMetadata;
	createdAt?: Date;
	organizationId?: string;
	projectId?: string;
}) {
	const [open, setOpen] = useState(false);
	const api = useApi();

	// Fallback A: message has requestId but enrichment didn't persist logId yet.
	const needsRequestIdFallback =
		open && !!metadata.requestId && !metadata.logId;

	// Fallback B: truly old message — no requestId was ever captured. Match by
	// model + tight time window, then disambiguate client-side by token counts + cost.
	const needsOldMessageFallback =
		open &&
		!metadata.logId &&
		!metadata.requestId &&
		!!metadata.usedModel &&
		!!createdAt;

	const modelName = metadata.usedModel?.includes("/")
		? metadata.usedModel.split("/").slice(1).join("/")
		: metadata.usedModel;

	const fifteenMinutesMs = 15 * 60 * 1000;
	const oneMinuteMs = 60 * 1000;
	const startDate = createdAt
		? new Date(createdAt.getTime() - fifteenMinutesMs).toISOString()
		: undefined;
	const endDate = createdAt
		? new Date(createdAt.getTime() + oneMinuteMs).toISOString()
		: undefined;

	const { data: requestIdLogData, isLoading: isRequestIdLoading } =
		api.useQuery(
			"get",
			"/logs",
			{
				params: {
					query: { requestId: metadata.requestId, limit: "1" },
				},
			},
			{ enabled: needsRequestIdFallback },
		);

	const { data: oldLogData, isLoading: isOldLoading } = api.useQuery(
		"get",
		"/logs",
		{
			params: {
				query: {
					model: modelName,
					startDate,
					endDate,
					...(currentOrgId ? { orgId: currentOrgId } : {}),
					...(currentProjectId ? { projectId: currentProjectId } : {}),
					limit: "10",
				},
			},
		},
		{ enabled: needsOldMessageFallback },
	);

	const matchedOldLog = needsOldMessageFallback
		? oldLogData?.logs?.find((log) => {
				const tokensMatch =
					Math.round(Number(log.promptTokens)) ===
						(metadata.usage?.inputTokens ?? -1) &&
					Math.round(Number(log.completionTokens)) ===
						(metadata.usage?.outputTokens ?? -1);
				const costMatch =
					metadata.usage?.totalCost === undefined ||
					Math.abs((log.cost ?? 0) - metadata.usage.totalCost) < 0.0001;
				return tokensMatch && costMatch;
			})
		: undefined;

	const fallbackLog = requestIdLogData?.logs?.[0] ?? matchedOldLog;

	const isLogLoading =
		(needsRequestIdFallback && isRequestIdLoading) ||
		(needsOldMessageFallback && isOldLoading);

	const discount = metadata.discount ?? fallbackLog?.discount;
	const logId = metadata.logId ?? fallbackLog?.id;
	const organizationId = metadata.organizationId ?? fallbackLog?.organizationId;
	const projectId = metadata.projectId ?? fallbackLog?.projectId;
	const usage = metadata.usage;
	const rows = [
		["Total cost", formatCost(usage?.totalCost)],
		["Input tokens", formatTokenCount(usage?.inputTokens)],
		["Cached input tokens", formatTokenCount(usage?.cachedInputTokens)],
		["Output tokens", formatTokenCount(usage?.outputTokens)],
		["Used model", metadata.usedModel ?? "-"],
	] as const;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							aria-label="Show response metadata"
							className="relative size-9 p-1.5 text-muted-foreground hover:text-foreground"
							size="sm"
							type="button"
							variant="ghost"
						>
							<Info className="size-3" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>
					<p>Response metadata</p>
				</TooltipContent>
			</Tooltip>
			<PopoverContent align="start" className="w-80 p-3">
				<div className="space-y-2 text-xs">
					<p className="font-medium">Response metadata</p>
					<div className="space-y-1.5">
						{rows.map(([label, value]) => (
							<div
								className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3"
								key={label}
							>
								<span className="text-muted-foreground">{label}</span>
								<span className="break-words text-right font-mono">
									{value}
								</span>
							</div>
						))}
						{(needsRequestIdFallback || needsOldMessageFallback) &&
							isLogLoading && (
								<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
									<Skeleton className="h-3 w-12" />
									<Skeleton className="ml-auto h-3 w-16" />
								</div>
							)}
						{discount !== null && discount !== undefined && discount > 0 && (
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
								<span className="text-muted-foreground">Discount</span>
								<span className="flex items-center justify-end gap-1 font-mono text-emerald-500">
									<TrendingDown className="h-3 w-3" />
									{(discount * 100).toFixed(0)}% off
								</span>
							</div>
						)}
						{logId && organizationId && projectId && (
							<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-3">
								<span className="text-muted-foreground">Activity log</span>
								<span className="flex items-center justify-end">
									<a
										href={`${process.env.NODE_ENV === "development" ? "http://localhost:3002" : "https://llmgateway.io"}/dashboard/${organizationId}/${projectId}/activity/${logId}`}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-foreground"
									>
										<ExternalLinkIcon className="h-3 w-3" />
									</a>
								</span>
							</div>
						)}
					</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}

// rerender-memo: Memoize message component to prevent re-renders when only streaming status changes
const AssistantMessage = memo(
	({
		message,
		isLastMessage,
		status,
		regenerate,
		finishReason,
		forkChat,
		isForkingChat,
		organizationId,
		projectId,
	}: {
		message: UIMessage;
		isLastMessage: boolean;
		status: string;
		regenerate: () => void;
		finishReason?: string | null;
		forkChat?: () => void | Promise<void>;
		isForkingChat?: boolean;
		organizationId?: string;
		projectId?: string;
	}) => {
		// useMemo for extracted parts to avoid recomputation
		const { textParts, imageParts, toolParts, reasoningContent, sourceParts } =
			useMemo(() => {
				return extractMessageParts(message.parts);
			}, [message.parts]);
		const metadata = useMemo(
			() => parsePlaygroundMessageMetadata(message.metadata),
			[message.metadata],
		);
		const textContent = textParts.join("");

		return (
			<div className="message-item">
				{reasoningContent ? (
					<Reasoning
						className="w-full"
						defaultOpen={false}
						isStreaming={status === "streaming" && isLastMessage}
					>
						<ReasoningTrigger />
						<ReasoningContent>{reasoningContent}</ReasoningContent>
					</Reasoning>
				) : null}

				{toolParts.map((tool) => (
					<Tool key={tool.toolCallId}>
						<ToolHeader
							title={tool.toolName}
							type={tool.type as `tool-${string}`}
							state={tool.state}
						/>
						<ToolContent>
							<ToolInput input={tool.input} />
							<ToolOutput errorText={tool.errorText} output={tool.output} />
						</ToolContent>
					</Tool>
				))}

				{textContent ? (
					<Response isStreaming={status === "streaming" && isLastMessage}>
						{textContent}
					</Response>
				) : null}

				{imageParts.length > 0 ? (
					<div className={getMessageImageGridClass(imageParts.length)}>
						{imageParts.map((part: any, idx: number) => {
							const { base64Only, mediaType } = parseImagePartToDataUrl(part);
							if (!base64Only) {
								return null;
							}
							return (
								<ImageZoom key={idx}>
									<Image
										base64={base64Only}
										mediaType={mediaType}
										alt={part.name ?? "Generated image"}
										className={getMessageImageClass(
											imageParts.length,
											"h-[400px] aspect-auto",
										)}
									/>
								</ImageZoom>
							);
						})}
					</div>
				) : isLastMessage && status === "streaming" ? (
					<div className="mt-3">
						<Loader />
					</div>
				) : null}

				{sourceParts.length > 0 ? (
					<Sources>
						<SourcesTrigger count={sourceParts.length} />
						{sourceParts.map((part, i) => (
							<SourcesContent key={`${message.id}-${i}`}>
								<Source href={part.url} title={part.url} />
							</SourcesContent>
						))}
					</Sources>
				) : null}

				{isLastMessage && finishReason && (
					<div className="mt-2 flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
						<AlertTriangle className="size-3.5 shrink-0" />
						<span>{getFinishReasonLabel(finishReason)}</span>
					</div>
				)}

				{(metadata || isLastMessage) && (
					<Actions className="mt-2">
						{metadata ? (
							<MessageMetadataPopover
								metadata={metadata}
								createdAt={
									(message as UIMessage & { createdAt?: Date }).createdAt
								}
								organizationId={organizationId}
								projectId={projectId}
							/>
						) : null}
						{isLastMessage ? (
							<>
								<Action
									onClick={() => regenerate()}
									label="Retry"
									tooltip="Regenerate response"
								>
									<RefreshCcw className="size-3" />
								</Action>
								{forkChat ? (
									<Action
										disabled={isForkingChat}
										onClick={() => {
											void forkChat();
										}}
										label="Fork chat"
										tooltip="Fork chat"
									>
										{isForkingChat ? (
											<Loader2 className="size-3 animate-spin" />
										) : (
											<GitFork className="size-3" />
										)}
									</Action>
								) : null}
								<Action
									onClick={async () => {
										try {
											await navigator.clipboard.writeText(textContent);
											toast.success("Copied to clipboard");
										} catch {
											toast.error("Failed to copy to clipboard");
										}
									}}
									label="Copy"
									tooltip="Copy to clipboard"
								>
									<Copy className="size-3" />
								</Action>
							</>
						) : null}
					</Actions>
				)}
			</div>
		);
	},
);

// rerender-memo: Memoize user message component
const UserMessage = memo(
	({
		message,
		isLastMessage,
		status,
		canEdit,
		isEditing,
		onEditStart,
		onEditCancel,
		onEditConfirm,
	}: {
		message: UIMessage;
		isLastMessage: boolean;
		status: string;
		canEdit?: boolean;
		isEditing?: boolean;
		onEditStart?: () => void;
		onEditCancel?: () => void;
		onEditConfirm?: (content: string) => Promise<void>;
	}) => {
		const { textParts, imageParts, audioParts } = useMemo(
			() => extractMessageParts(message.parts),
			[message.parts],
		);
		const initialText = textParts.join("\n");
		const [editText, setEditText] = useState(initialText);
		const [isSaving, setIsSaving] = useState(false);

		useEffect(() => {
			if (isEditing) {
				setEditText(initialText);
			}
		}, [initialText, isEditing]);

		const handleEditConfirm = async () => {
			if (!onEditConfirm || isSaving) {
				return;
			}
			if (!editText.trim() && imageParts.length === 0) {
				return;
			}
			setIsSaving(true);
			try {
				await onEditConfirm(editText);
			} finally {
				setIsSaving(false);
			}
		};

		return (
			<Message from={message.role} className="message-item group/user-message">
				<div
					className={cn(
						"flex flex-col items-end",
						getUserMessageWidthClass(imageParts.length, isEditing),
					)}
				>
					<MessageContent
						className={cn("!max-w-full", isEditing && "w-full px-5 py-4")}
						variant="flat"
					>
						{isEditing ? (
							<div className="flex w-full min-w-0 flex-col gap-3">
								<Textarea
									value={editText}
									onChange={(event) => setEditText(event.currentTarget.value)}
									className="min-h-24 w-full min-w-0 resize-y bg-background text-foreground"
									autoFocus
								/>
								<div className="flex flex-wrap justify-end gap-2">
									<Button
										type="button"
										size="sm"
										variant="secondary"
										onClick={onEditCancel}
										disabled={isSaving}
										className="rounded-full"
									>
										Cancel
									</Button>
									<Button
										type="button"
										size="sm"
										onClick={() => void handleEditConfirm()}
										disabled={
											isSaving || (!editText.trim() && imageParts.length === 0)
										}
										className="rounded-full"
									>
										Send
									</Button>
								</div>
							</div>
						) : (
							<>
								{textParts.map((t, idx) => (
									<div key={idx}>{t}</div>
								))}
							</>
						)}
						{imageParts.length > 0 && (
							<div
								className={getMessageImageGridClass(imageParts.length, true)}
							>
								{imageParts.map((part: any, idx: number) => {
									const { base64Only, mediaType } =
										parseImagePartToDataUrl(part);
									if (!base64Only) {
										return null;
									}
									return (
										<ImageZoom key={idx}>
											<Image
												base64={base64Only}
												mediaType={mediaType}
												alt={part.name ?? "Uploaded image"}
												className={getMessageImageClass(
													imageParts.length,
													"h-[300px] aspect-auto",
												)}
											/>
										</ImageZoom>
									);
								})}
							</div>
						)}
						{audioParts.length > 0 && (
							<div className="mt-3 flex flex-col gap-2">
								{audioParts.map((part: any, idx: number) => (
									<audio
										key={idx}
										controls
										src={part.url}
										className="w-full max-w-md"
										aria-label={
											part.name ?? part.filename ?? "Audio attachment"
										}
									>
										<track kind="captions" />
									</audio>
								))}
							</div>
						)}
					</MessageContent>
					{canEdit && !isEditing ? (
						<Actions className="mt-2 opacity-0 transition-opacity group-hover/user-message:opacity-100 focus-within:opacity-100">
							<Action
								onClick={onEditStart}
								label="Edit and retry"
								tooltip="Edit and retry from here"
							>
								<Undo2 className="size-3" />
							</Action>
						</Actions>
					) : null}
				</div>
			</Message>
		);
	},
);

export function ReadOnlyChatMessages({ messages }: { messages: UIMessage[] }) {
	return (
		<Conversation>
			<ConversationContent className="mx-auto max-w-4xl px-4 py-8">
				{messages.map((message) => {
					if (message.role === "assistant") {
						return (
							<AssistantMessage
								key={message.id}
								message={message}
								isLastMessage={false}
								status="ready"
								regenerate={() => {}}
								finishReason={null}
							/>
						);
					}

					return (
						<UserMessage
							key={message.id}
							message={message}
							isLastMessage={false}
							status="ready"
						/>
					);
				})}
			</ConversationContent>
		</Conversation>
	);
}

export const ChatUI = ({
	messages,
	supportsImages,
	supportsAudio,
	supportsImageGen,
	sendMessage,
	selectedModel,
	text,
	setText,
	status,
	stop,
	regenerate,
	reasoningEffort,
	setReasoningEffort,
	supportsReasoning,
	imageAspectRatio,
	setImageAspectRatio,
	imageSize,
	setImageSize,
	alibabaImageSize,
	setAlibabaImageSize,
	imageQuality,
	setImageQuality,
	imageCount,
	setImageCount,
	supportsWebSearch,
	webSearchEnabled,
	setWebSearchEnabled,
	onUserMessage,
	onEditUserMessage,
	isLoading = false,
	error = null,
	finishReason = null,
	floatingInput = false,
	isTemporaryChat = false,
	forkChat,
	isForkingChat = false,
	activeSkills = [],
	onSelectSkill,
	onRemoveSkill,
	organizationId,
	projectId,
}: ChatUIProps) => {
	// OpenAI gpt-image-2 uses pixel dimensions and supports a quality dropdown
	const isGptImage =
		selectedModel.toLowerCase().includes("gpt-image") ||
		selectedModel.toLowerCase().includes("openai/gpt-image");

	// Check if the model uses WIDTHxHEIGHT format (Alibaba, ZAI, or OpenAI gpt-image)
	const usesPixelDimensions =
		isGptImage ||
		selectedModel.toLowerCase().includes("alibaba") ||
		selectedModel.toLowerCase().includes("qwen-image") ||
		selectedModel.toLowerCase().includes("zai") ||
		selectedModel.toLowerCase().includes("cogview");

	// Seedream/ByteDance models only support 2K and 4K
	const isSeedream =
		selectedModel.toLowerCase().includes("seedream") ||
		selectedModel.toLowerCase().includes("bytedance/seedream");

	// Gemini 3.1 Flash Image supports 0.5K, 1K (default), 2K, 4K
	const isGemini31FlashImage = selectedModel
		.toLowerCase()
		.includes("gemini-3.1-flash-image");

	const availableSizes = isSeedream
		? (["2K", "4K"] as const)
		: isGemini31FlashImage
			? (["0.5K", "1K", "2K", "4K"] as const)
			: (["1K", "2K", "4K"] as const);

	const qualityOptions = ["auto", "low", "medium", "high"] as const;

	const [activeGroup, setActiveGroup] = useState<HeroSuggestionGroup>("Create");
	const [randomizedHeroSuggestionGroups, setRandomizedHeroSuggestionGroups] =
		useState<Record<HeroSuggestionGroup, readonly string[]> | null>(null);
	useEffect(
		() => setRandomizedHeroSuggestionGroups(getRandomHeroSuggestionGroups()),
		[],
	);
	const visibleHeroSuggestionGroups: HeroSuggestionGroup[] = supportsImageGen
		? ["Image gen"]
		: ["Create", "Explore", "Code"];
	const activeSuggestionGroup: HeroSuggestionGroup = supportsImageGen
		? "Image gen"
		: visibleHeroSuggestionGroups.includes(activeGroup)
			? activeGroup
			: "Create";
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const inputRef = useRef<HTMLDivElement | null>(null);
	const [inputHeight, setInputHeight] = useState(0);
	const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

	const [skillTriggerOpen, setSkillTriggerOpen] = useState(false);
	const [skillTriggerPos, setSkillTriggerPos] = useState({ top: 0, left: 0 });
	const [skillTriggerFilter, setSkillTriggerFilter] = useState("");
	const skillTriggerIndexRef = useRef(-1);

	const handleSkillTriggerSelect = useCallback(
		(skill: Skill) => {
			const before = text.slice(0, skillTriggerIndexRef.current);
			const after = text.slice(
				skillTriggerIndexRef.current + 1 + skillTriggerFilter.length,
			);
			setText(before + after);
			onSelectSkill?.(skill);
			setSkillTriggerOpen(false);
			skillTriggerIndexRef.current = -1;
			setTimeout(() => textareaRef.current?.focus(), 0);
		},
		[text, skillTriggerFilter, setText, onSelectSkill],
	);

	const updateInputHeight = useCallback(() => {
		if (inputRef.current) {
			setInputHeight(inputRef.current.offsetHeight);
		}
	}, []);

	useEffect(() => {
		updateInputHeight();
		const observer = new ResizeObserver(updateInputHeight);
		if (inputRef.current) {
			observer.observe(inputRef.current);
		}
		return () => observer.disconnect();
	}, [updateInputHeight]);
	// Centralized busy/active gates: isBusy blocks new submissions; isActive
	// governs the Stop button which should only show while a request is in flight.
	const isActive = status === "streaming" || status === "submitted";
	const isBusy = isLoading || isActive;
	const canEditUserMessages =
		!isBusy && !isTemporaryChat && !!onEditUserMessage;

	const handlePromptSubmit = async (
		textContent: string,
		files?: Array<{
			url?: string | null;
			mediaType?: string | null;
			filename?: string | null;
		}>,
	) => {
		if (isBusy) {
			return;
		}

		try {
			const content = textContent ?? "";
			if (!content.trim() && !files?.length) {
				return;
			}

			setText(""); // Clear input immediately

			const parts: any[] = [];
			const imagesToSave =
				supportsImages && files?.length
					? files
							.filter((f) => f.mediaType?.startsWith("image/") && f.url)
							.map((f) => ({
								type: "image_url" as const,
								image_url: { url: f.url! },
							}))
					: undefined;

			const audioToSave =
				supportsAudio && files?.length
					? files
							.filter((f) => f.mediaType?.startsWith("audio/") && f.url)
							.map((f) => ({
								type: "audio" as const,
								url: f.url!,
								mediaType: f.mediaType!,
								...(f.filename ? { name: f.filename } : {}),
							}))
					: undefined;

			if (content.trim()) {
				parts.push({ type: "text", text: content });
			}

			// Attach user images/files as AI SDK "file" parts so vision /
			// image-generation models can actually consume them.
			if (supportsImages && files?.length) {
				for (const file of files) {
					if (file.mediaType?.startsWith("image/") && file.url) {
						parts.push({
							type: "file",
							url: file.url,
							mediaType: file.mediaType,
							name: file.filename,
						});
					}
				}
			}

			if (supportsAudio && files?.length) {
				for (const file of files) {
					if (file.mediaType?.startsWith("audio/") && file.url) {
						parts.push({
							type: "file",
							url: file.url,
							mediaType: file.mediaType,
							name: file.filename,
						});
					}
				}
			}

			if (parts.length === 0) {
				return;
			}

			const generatedMessageId = crypto.randomUUID();
			let savedMessage: { id: string } | undefined;

			// Ensure the chat exists + user message is persisted BEFORE streaming starts.
			// Otherwise `onFinish` may run before `chatIdRef` is set, and we can't save the AI response.
			if (
				onUserMessage &&
				(content.trim() || imagesToSave?.length || audioToSave?.length)
			) {
				savedMessage =
					(await onUserMessage(content, imagesToSave, audioToSave)) ??
					undefined;
			}

			// If a persistent chat was expected (onUserMessage provided) but persistence
			// returned nothing, a stop condition was hit (credits, limit, etc.).
			// Temporary chats intentionally return undefined — streaming must still proceed.
			if (onUserMessage && !savedMessage && !isTemporaryChat) {
				return;
			}

			// Call sendMessage which will handle adding the user message and API request
			await sendMessage(
				{
					id: savedMessage?.id ?? generatedMessageId,
					role: "user",
					parts,
				},
				{
					body: {
						model: selectedModel,
					},
				},
			);
		} catch (e) {
			toast.error(
				`Could not send message. ${e instanceof Error ? e.message : ""}`.trim(),
			);
		}
	};
	const messagesContent =
		isLoading && messages.length === 0 ? (
			<div className="flex items-center justify-center h-full">
				<Loader />
			</div>
		) : messages.length === 0 ? (
			<AnimatePresence mode="wait" initial={false}>
				<motion.div
					key={isTemporaryChat ? "temporary-chat-empty" : "regular-chat-empty"}
					initial={{ opacity: 0, scale: 0.96 }}
					animate={{ opacity: 1, scale: 1 }}
					exit={{ opacity: 0, scale: 0.96 }}
					transition={{
						opacity: { duration: 0.06, ease: "easeOut" },
						scale: { duration: 0.14, ease: "easeOut" },
					}}
					className={`mx-auto w-full max-w-3xl ${
						isTemporaryChat
							? "flex flex-1 items-center justify-center py-10"
							: "py-10"
					}`}
				>
					<motion.div
						className={`${isTemporaryChat ? "mb-0" : "mb-6"} text-center`}
						layout
						transition={{ duration: 0.14, ease: "easeOut" }}
					>
						<h2 className="text-3xl font-semibold tracking-tight">
							{isTemporaryChat ? "Temporary Chat" : "How can I help you?"}
						</h2>
						<AnimatePresence initial={false}>
							{isTemporaryChat ? (
								<motion.p
									key="temporary-subtitle"
									initial={{ opacity: 0, scale: 0.97 }}
									animate={{ opacity: 1, scale: 1 }}
									exit={{ opacity: 0, scale: 0.97 }}
									transition={{
										opacity: { duration: 0.06, ease: "easeOut" },
										scale: { duration: 0.12, ease: "easeOut" },
									}}
									className="mt-2 text-sm text-muted-foreground"
								>
									Temporary chats will not appear in your chat history.
								</motion.p>
							) : null}
						</AnimatePresence>
					</motion.div>
					<AnimatePresence initial={false}>
						{isTemporaryChat ? null : (
							<motion.div
								key="regular-chat-suggestions"
								initial={{ opacity: 0, height: 0, scale: 0.97 }}
								animate={{ opacity: 1, height: "auto", scale: 1 }}
								exit={{ opacity: 0, height: 0, scale: 0.97 }}
								transition={{
									opacity: { duration: 0.06, ease: "easeOut" },
									height: { duration: 0.16, ease: "easeOut" },
									scale: { duration: 0.14, ease: "easeOut" },
								}}
								className="overflow-hidden"
							>
								{visibleHeroSuggestionGroups.length > 1 ? (
									<div className="mb-6 flex justify-center gap-2">
										{visibleHeroSuggestionGroups.map((key) => (
											<Button
												key={key}
												size="sm"
												variant={
													activeSuggestionGroup === key
														? "default"
														: "secondary"
												}
												onClick={() => setActiveGroup(key)}
												className="rounded-full"
											>
												{key}
											</Button>
										))}
									</div>
								) : null}
								<AnimatePresence mode="wait">
									{randomizedHeroSuggestionGroups ? (
										<motion.div
											key={activeSuggestionGroup}
											initial={{ opacity: 0 }}
											animate={{ opacity: 1 }}
											exit={{ opacity: 0 }}
											transition={{ duration: 0.07, ease: "easeOut" }}
											className="space-y-2"
										>
											{randomizedHeroSuggestionGroups[
												activeSuggestionGroup
											].map((s, index) => (
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
													onClick={() => {
														void handlePromptSubmit(s);
													}}
													className="w-full rounded-md border px-4 py-3 text-left text-sm hover:bg-muted/60"
												>
													{s}
												</motion.button>
											))}
										</motion.div>
									) : null}
								</AnimatePresence>
							</motion.div>
						)}
					</AnimatePresence>
				</motion.div>
			</AnimatePresence>
		) : (
			<>
				{messages.map((m, messageIndex) => {
					const isLastMessage = messageIndex === messages.length - 1;

					if (m.role === "assistant") {
						return (
							<AssistantMessage
								key={m.id}
								message={m}
								isLastMessage={isLastMessage}
								status={status}
								regenerate={regenerate}
								finishReason={isLastMessage ? finishReason : null}
								forkChat={
									isLastMessage && status === "ready" ? forkChat : undefined
								}
								isForkingChat={isForkingChat}
								organizationId={organizationId}
								projectId={projectId}
							/>
						);
					} else {
						return (
							<UserMessage
								key={m.id}
								message={m}
								isLastMessage={isLastMessage}
								status={status}
								canEdit={canEditUserMessages}
								isEditing={editingMessageId === m.id}
								onEditStart={() => setEditingMessageId(m.id)}
								onEditCancel={() => setEditingMessageId(null)}
								onEditConfirm={async (content) => {
									if (!onEditUserMessage) {
										return;
									}
									setEditingMessageId(null);
									await onEditUserMessage(m, content);
								}}
							/>
						);
					}
				})}
				{status === "submitted" && (
					<div className="message-item mt-3">
						<Loader />
					</div>
				)}
				{messages.length > 0 &&
					messages[messages.length - 1].role === "user" &&
					error && (
						<div className="message-item mt-2 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
							<AlertTriangle className="size-3.5 shrink-0" />
							<span>{error}</span>
						</div>
					)}
			</>
		);

	const inputArea = (
		<div
			ref={floatingInput ? inputRef : undefined}
			className={
				floatingInput
					? "absolute bottom-0 left-0 right-0 z-10 px-0 pb-0 sm:px-4"
					: "shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 bg-background border-t"
			}
		>
			<motion.div
				layout
				className={
					floatingInput
						? "mx-auto w-full max-w-4xl px-0 pb-0 pt-2 bg-background sm:px-4"
						: undefined
				}
				transition={{ duration: 0.18, ease: "easeOut" }}
			>
				<PromptInput
					key={`prompt-input-${supportsImages ? "img" : ""}${supportsAudio ? "aud" : ""}`}
					className={
						floatingInput
							? "[&_[data-slot=input-group]]:rounded-none [&_[data-slot=input-group]]:border-x-0 [&_[data-slot=input-group]]:border-b-0 sm:[&_[data-slot=input-group]]:rounded-md sm:[&_[data-slot=input-group]]:border"
							: undefined
					}
					accept={
						supportsImages && supportsAudio
							? "image/*,audio/*"
							: supportsImages
								? "image/*"
								: supportsAudio
									? "audio/*"
									: undefined
					}
					multiple
					globalDrop={supportsImages || supportsAudio}
					aria-disabled={isBusy}
					onSubmit={(message) => {
						void handlePromptSubmit(message.text ?? "", message.files);
					}}
				>
					<PromptInputBody>
						{activeSkills.length > 0 && (
							<div className="w-full flex flex-wrap gap-1.5 px-2 pt-2">
								{activeSkills.map((skill) => (
									<SkillChip
										key={skill.id}
										skill={skill}
										onRemove={() => onRemoveSkill?.(skill.id)}
									/>
								))}
							</div>
						)}
						<PromptInputAttachments>
							{(attachment) => <PromptInputAttachment data={attachment} />}
						</PromptInputAttachments>
						<PromptInputTextarea
							ref={textareaRef}
							value={text}
							onChange={(e) => {
								const value = e.currentTarget.value;
								const cursor = e.currentTarget.selectionStart ?? value.length;
								setText(value);
								const textUpToCursor = value.slice(0, cursor);
								const match = textUpToCursor.match(
									/(?:^|(?<=\s))@([a-zA-Z_-]*)$/,
								);
								if (match) {
									const idx = cursor - match[0].length;
									skillTriggerIndexRef.current = idx;
									setSkillTriggerFilter(match[1].toLowerCase());
									setSkillTriggerOpen(true);
									if (textareaRef.current) {
										const coords = getCaretCoordinates(
											textareaRef.current,
											idx,
										);
										const rect = textareaRef.current.getBoundingClientRect();
										setSkillTriggerPos({
											top:
												rect.top + coords.top - textareaRef.current.scrollTop,
											left: rect.left + coords.left,
										});
									}
								} else {
									setSkillTriggerOpen(false);
									skillTriggerIndexRef.current = -1;
								}
							}}
							placeholder="Message"
							disabled={isLoading}
						/>
					</PromptInputBody>
					<PromptInputToolbar>
						<PromptInputTools>
							{(supportsImages || supportsAudio) && (
								<PromptInputActionMenu>
									<PromptInputActionMenuTrigger />
									<PromptInputActionMenuContent>
										<PromptInputActionAddAttachments
											label={
												supportsImages && supportsAudio
													? "Add photos, audio or files"
													: supportsAudio
														? "Add audio"
														: undefined
											}
										/>
									</PromptInputActionMenuContent>
								</PromptInputActionMenu>
							)}
							<PromptInputSpeechButton
								onTranscriptionChange={setText}
								textareaRef={textareaRef}
							/>
							{supportsWebSearch && (
								<PromptInputButton
									variant={webSearchEnabled ? "default" : "ghost"}
									onClick={() => setWebSearchEnabled(!webSearchEnabled)}
								>
									<GlobeIcon size={16} />
								</PromptInputButton>
							)}
							<SkillPickerButton
								onSelectSkill={onSelectSkill}
								activeSkills={activeSkills}
							/>
						</PromptInputTools>
						<div className="flex items-center gap-2">
							{supportsReasoning && (
								<Select
									value={reasoningEffort ? reasoningEffort : "off"}
									onValueChange={(val) =>
										setReasoningEffort(
											val === "off"
												? ""
												: ((val as "minimal" | "low" | "medium" | "high") ??
														""),
										)
									}
								>
									<SelectTrigger size="sm" className="min-w-[120px]">
										<Brain size={16} />
										<SelectValue placeholder="Reasoning" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="off">Auto</SelectItem>
										{selectedModel.includes("gpt-5") && (
											<SelectItem value="minimal">Minimal</SelectItem>
										)}
										<SelectItem value="low">Low</SelectItem>
										<SelectItem value="medium">Medium</SelectItem>
										<SelectItem value="high">High</SelectItem>
									</SelectContent>
								</Select>
							)}
							{supportsImageGen && !usesPixelDimensions && (
								<>
									<Select
										value={imageAspectRatio}
										onValueChange={(val) =>
											setImageAspectRatio(
												val as
													| "auto"
													| "1:1"
													| "9:16"
													| "16:9"
													| "3:4"
													| "4:3"
													| "3:2"
													| "2:3"
													| "5:4"
													| "4:5"
													| "21:9"
													| "1:4"
													| "4:1"
													| "1:8"
													| "8:1",
											)
										}
									>
										<SelectTrigger size="sm" className="min-w-[110px]">
											<SelectValue placeholder="Aspect ratio" />
										</SelectTrigger>
										<SelectContent>
											{[
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
											].map((r) => (
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
											{availableSizes.map((size) => (
												<SelectItem key={size} value={size}>
													{size}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</>
							)}
							{supportsImageGen && usesPixelDimensions && isGptImage && (
								<>
									<Select
										value={alibabaImageSize}
										onValueChange={setAlibabaImageSize}
									>
										<SelectTrigger size="sm" className="min-w-[130px]">
											<SelectValue placeholder="Resolution" />
										</SelectTrigger>
										<SelectContent>
											{GPT_IMAGE_SIZES.map((size) => (
												<SelectItem key={size} value={size}>
													{size === "auto" ? "Auto" : size}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<Select value={imageQuality} onValueChange={setImageQuality}>
										<SelectTrigger size="sm" className="min-w-[100px]">
											<SelectValue placeholder="Quality" />
										</SelectTrigger>
										<SelectContent>
											{qualityOptions.map((q) => (
												<SelectItem key={q} value={q}>
													{q.charAt(0).toUpperCase() + q.slice(1)}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</>
							)}
							{supportsImageGen && usesPixelDimensions && !isGptImage && (
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
							{supportsImageGen && (
								<Select
									value={String(imageCount)}
									onValueChange={(val) =>
										setImageCount(Number(val) as 1 | 2 | 3 | 4)
									}
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
							)}
							{isActive ? (
								<PromptInputButton onClick={() => stop()} variant="ghost">
									Stop
								</PromptInputButton>
							) : null}
							<PromptInputSubmit
								status={
									status === "streaming"
										? "streaming"
										: status === "submitted"
											? "submitted"
											: "ready"
								}
								disabled={isBusy}
							/>
						</div>
					</PromptInputToolbar>
				</PromptInput>
				<SkillTriggerMenu
					open={skillTriggerOpen}
					position={skillTriggerPos}
					filter={skillTriggerFilter}
					onSelect={handleSkillTriggerSelect}
					onClose={() => setSkillTriggerOpen(false)}
				/>
				<AnimatePresence initial={false}>
					{isTemporaryChat ? (
						<motion.p
							key="temporary-chat-disclosure"
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: 8 }}
							transition={{ duration: 0.16, ease: "easeOut" }}
							className="px-1 pt-2 pb-3 text-center text-xs text-muted-foreground"
						>
							Some responses are saved for up to 72 hours before they are
							deleted, read our{" "}
							<a
								href="https://llmgateway.io/legal/terms"
								target="_blank"
								rel="noopener noreferrer"
								className="underline underline-offset-2 transition-colors hover:text-foreground"
							>
								terms of use
							</a>{" "}
							for more details
						</motion.p>
					) : null}
				</AnimatePresence>
			</motion.div>
		</div>
	);

	if (floatingInput) {
		return (
			<div className="relative flex flex-col h-full min-h-0">
				<Conversation>
					<ConversationContent
						className={`mx-auto max-w-4xl px-4 ${
							isTemporaryChat && messages.length === 0
								? "flex min-h-full w-full items-center justify-center"
								: ""
						}`}
						style={{ paddingBottom: `${inputHeight + 16}px` }}
					>
						{messagesContent}
					</ConversationContent>
				</Conversation>
				{inputArea}
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="flex flex-col flex-1 min-h-0">
				<Conversation>
					<ConversationContent
						className={`px-4 pb-4 ${
							isTemporaryChat && messages.length === 0
								? "flex min-h-full items-center justify-center"
								: ""
						}`}
					>
						{messagesContent}
					</ConversationContent>
				</Conversation>
			</div>
			{inputArea}
		</div>
	);
};

function SkillChip({
	skill,
	onRemove,
}: {
	skill: Skill;
	onRemove?: () => void;
}) {
	return (
		<div className="inline-flex items-center gap-1.5 rounded-md border bg-muted px-2 py-1 text-xs font-medium">
			<ScrollTextIcon className="h-3 w-3 text-muted-foreground" />
			<span>{skill.name}</span>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					className="text-muted-foreground hover:text-foreground ml-0.5 rounded"
					aria-label="Remove skill"
				>
					<XIcon className="h-3 w-3" />
				</button>
			)}
		</div>
	);
}

function SkillPickerButton({
	onSelectSkill,
	activeSkills = [],
}: {
	onSelectSkill?: (skill: Skill) => void;
	activeSkills?: Skill[];
}) {
	const [createOpen, setCreateOpen] = useState(false);
	const router = useRouter();
	const { data } = useSkills();
	const skills = (data?.skills as Skill[] | undefined) ?? [];
	const enabledSkills = skills.filter((s) => s.enabled);
	const activeIds = new Set(activeSkills.map((s) => s.id));

	return (
		<>
			<Popover>
				<PopoverTrigger asChild>
					<PromptInputButton
						variant={activeSkills.length > 0 ? "default" : "ghost"}
						aria-label="Select a skill"
					>
						<ScrollTextIcon size={16} />
					</PromptInputButton>
				</PopoverTrigger>
				<PopoverContent align="start" className="w-64 p-1">
					<div className="mb-1 flex items-center justify-between px-2 py-1">
						<span className="text-xs font-medium text-muted-foreground">
							Select a skill
						</span>
						<div className="flex items-center gap-0.5">
							<button
								type="button"
								className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="View all skills"
								onClick={() => router.push("/skills")}
							>
								<ExternalLinkIcon className="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="Create skill"
								onClick={() => setCreateOpen(true)}
							>
								<PlusIcon className="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
					{enabledSkills.length === 0 ? (
						<p className="px-2 py-3 text-center text-xs text-muted-foreground">
							No skills yet. Click + to create one.
						</p>
					) : (
						enabledSkills.map((skill) => {
							const isActive = activeIds.has(skill.id);
							return (
								<button
									key={skill.id}
									type="button"
									className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-muted"
									onClick={() => !isActive && onSelectSkill?.(skill)}
								>
									<ScrollTextIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<div className="truncate font-medium">{skill.name}</div>
										{skill.description && (
											<div className="truncate text-xs text-muted-foreground">
												{skill.description}
											</div>
										)}
									</div>
									{isActive && (
										<span className="ml-auto text-xs text-muted-foreground">
											✓
										</span>
									)}
								</button>
							);
						})
					)}
				</PopoverContent>
			</Popover>
			<CreateSkillDialog open={createOpen} onOpenChange={setCreateOpen} />
		</>
	);
}

function SkillTriggerMenu({
	open,
	position,
	filter,
	onSelect,
	onClose,
}: {
	open: boolean;
	position: { top: number; left: number };
	filter: string;
	onSelect: (skill: Skill) => void;
	onClose: () => void;
}) {
	const { data } = useSkills();
	const [highlight, setHighlight] = useState(0);
	const skills = (data?.skills as Skill[] | undefined) ?? [];
	const filtered = skills
		.filter((s) => s.enabled)
		.filter((s) => !filter || s.name.toLowerCase().includes(filter));

	useEffect(() => {
		setHighlight(0);
	}, [filter]);

	useEffect(() => {
		if (!open) {
			return;
		}
		const handler = (e: KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setHighlight((h) => (h + 1) % Math.max(filtered.length, 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setHighlight(
					(h) =>
						(h - 1 + Math.max(filtered.length, 1)) %
						Math.max(filtered.length, 1),
				);
			} else if (e.key === "Enter") {
				e.preventDefault();
				if (filtered[highlight]) {
					onSelect(filtered[highlight]);
				}
			} else if (e.key === "Escape") {
				onClose();
			}
		};
		window.addEventListener("keydown", handler, true);
		return () => window.removeEventListener("keydown", handler, true);
	}, [open, filtered, highlight, onSelect, onClose]);

	if (!open || filtered.length === 0) {
		return null;
	}

	const ITEM_HEIGHT = 52;
	const itemsHeight = filtered.length * ITEM_HEIGHT;
	const menuHeight = Math.min(itemsHeight + 8, 240);

	return createPortal(
		<div
			style={{
				position: "fixed",
				top: position.top - menuHeight - 6,
				left: position.left,
				zIndex: 9999,
				width: 240,
			}}
			className="rounded-md border bg-popover p-1 shadow-md"
		>
			{filtered.map((skill, i) => (
				<button
					key={skill.id}
					type="button"
					className={cn(
						"flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
						i === highlight ? "bg-muted" : "hover:bg-muted",
					)}
					onMouseEnter={() => setHighlight(i)}
					onClick={() => onSelect(skill)}
				>
					<ScrollTextIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<div className="truncate font-medium">{skill.name}</div>
						{skill.description && (
							<div className="truncate text-xs text-muted-foreground">
								{skill.description}
							</div>
						)}
					</div>
				</button>
			))}
		</div>,
		document.body,
	);
}
