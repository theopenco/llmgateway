"use client";
import { RefreshCcw, Copy, Brain, GlobeIcon } from "lucide-react";
import { useRef, useState, useEffect, useCallback, memo, useMemo } from "react";
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
import { Button } from "@/components/ui/button";
import { ImageZoom } from "@/components/ui/image-zoom";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { parseImagePartToDataUrl } from "@/lib/image-utils";

import type { UIMessage, ChatRequestOptions, ChatStatus } from "ai";

interface ChatUIProps {
	messages: UIMessage[];
	supportsImages: boolean;
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
		| "21:9";
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
			| "21:9",
	) => void;
	imageSize: "1K" | "2K" | "4K";
	setImageSize: (value: "1K" | "2K" | "4K") => void;
	alibabaImageSize: string;
	setAlibabaImageSize: (value: string) => void;
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
	) => Promise<void>;
	isLoading?: boolean;
	error?: string | null;
	floatingInput?: boolean;
}

const suggestions = [
	"Write a Python script to analyze CSV data and create visualizations",
	"Create a compelling elevator pitch for a sustainable fashion startup",
	"Explain quantum computing like I'm 12 years old",
	"Design a 7-day workout plan for busy professionals",
	"Write a short mystery story in exactly 100 words",
	"Debug this React component and suggest performance improvements",
	"Plan the perfect weekend in Tokyo for first-time visitors",
	"Generate creative Instagram captions for a coffee shop",
	"Analyze the pros and cons of different programming languages",
	"Create a meal prep plan for someone with a nut allergy",
];

const heroSuggestionGroups = {
	Create: suggestions,
	Explore: [
		"What are trending AI research topics right now?",
		"Summarize the latest news about TypeScript",
		"Find interesting datasets for a side project",
		"Suggest tech blogs to follow for frontend performance",
	],
	Code: [
		"Refactor this React component for readability",
		"Write unit tests for a Node.js service",
		"Explain how to debounce an input in React",
		"Show an example of a Zod schema with refinement",
	],
	"Image gen": [
		"Generate an image of a cyberpunk city at night",
		"Create a serene mountain landscape at sunrise",
		"Design a futuristic robot assistant",
	],
};

// js-combine-iterations: Extract message parts in a single pass instead of multiple filter() calls
interface ExtractedParts {
	textParts: string[];
	imageParts: any[];
	toolParts: any[];
	reasoningContent: string;
	sourceParts: any[];
}

function extractMessageParts(parts: any[]): ExtractedParts {
	const textParts: string[] = [];
	const imageParts: any[] = [];
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
		}
	}

	return {
		textParts,
		imageParts,
		toolParts,
		reasoningContent: reasoningParts.join(""),
		sourceParts,
	};
}

// rerender-memo: Memoize message component to prevent re-renders when only streaming status changes
const AssistantMessage = memo(
	({
		message,
		isLastMessage,
		status,
		regenerate,
	}: {
		message: UIMessage;
		isLastMessage: boolean;
		status: string;
		regenerate: () => void;
	}) => {
		// useMemo for extracted parts to avoid recomputation
		const { textParts, imageParts, toolParts, reasoningContent, sourceParts } =
			useMemo(() => {
				return extractMessageParts(message.parts);
			}, [message.parts]);
		const textContent = textParts.join("");

		return (
			<div className="message-item">
				{reasoningContent ? (
					<Reasoning
						className="w-full"
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
					<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
										className="h-[400px] aspect-auto border rounded-lg object-cover"
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

				{isLastMessage && (
					<Actions className="mt-2">
						<Action
							onClick={() => regenerate()}
							label="Retry"
							tooltip="Regenerate response"
						>
							<RefreshCcw className="size-3" />
						</Action>
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
	}: {
		message: UIMessage;
		isLastMessage: boolean;
		status: string;
	}) => {
		const { textParts, imageParts } = useMemo(
			() => extractMessageParts(message.parts),
			[message.parts],
		);

		return (
			<Message from={message.role} className="message-item">
				<MessageContent variant="flat">
					{textParts.map((t, idx) => (
						<div key={idx}>{t}</div>
					))}
					{imageParts.length > 0 && (
						<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
											alt={part.name ?? "Uploaded image"}
											className="h-[300px] aspect-auto border rounded-lg object-cover"
										/>
									</ImageZoom>
								);
							})}
						</div>
					)}
				</MessageContent>
				{isLastMessage &&
					(status === "submitted" || status === "streaming") && <Loader />}
			</Message>
		);
	},
);

export const ChatUI = ({
	messages,
	supportsImages,
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
	supportsWebSearch,
	webSearchEnabled,
	setWebSearchEnabled,
	onUserMessage,
	isLoading = false,
	error = null,
	floatingInput = false,
}: ChatUIProps) => {
	// Check if the model uses WIDTHxHEIGHT format (Alibaba or ZAI)
	const usesPixelDimensions =
		selectedModel.toLowerCase().includes("alibaba") ||
		selectedModel.toLowerCase().includes("qwen-image") ||
		selectedModel.toLowerCase().includes("zai") ||
		selectedModel.toLowerCase().includes("cogview");

	const [activeGroup, setActiveGroup] =
		useState<keyof typeof heroSuggestionGroups>("Create");
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const inputRef = useRef<HTMLDivElement | null>(null);
	const [inputHeight, setInputHeight] = useState(0);

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
	const handlePromptSubmit = async (
		textContent: string,
		files?: Array<{
			url?: string | null;
			mediaType?: string | null;
			filename?: string | null;
		}>,
	) => {
		if (isLoading || status === "streaming") {
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

			if (parts.length === 0) {
				return;
			}

			// Ensure the chat exists + user message is persisted BEFORE streaming starts.
			// Otherwise `onFinish` may run before `chatIdRef` is set, and we can't save the AI response.
			if (onUserMessage && (content.trim() || imagesToSave?.length)) {
				await onUserMessage(content, imagesToSave);
			}

			// Call sendMessage which will handle adding the user message and API request
			await sendMessage(
				{
					id: crypto.randomUUID(),
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
			<div className="max-w-3xl mx-auto py-10">
				<div className="mb-6 text-center">
					<h2 className="text-3xl font-semibold tracking-tight">
						How can I help you?
					</h2>
				</div>
				<div className="mb-6 flex justify-center gap-2">
					{Object.keys(heroSuggestionGroups).map((key) => (
						<Button
							key={key}
							size="sm"
							variant={activeGroup === key ? "default" : "secondary"}
							onClick={() =>
								setActiveGroup(key as keyof typeof heroSuggestionGroups)
							}
							className="rounded-full"
						>
							{key}
						</Button>
					))}
				</div>
				{activeGroup === "Image gen" && !supportsImageGen ? (
					<div className="text-center text-sm text-muted-foreground py-8">
						Please select a model that supports image generation to use this
						feature.
					</div>
				) : (
					<div className="space-y-2">
						{heroSuggestionGroups[activeGroup].slice(0, 5).map((s) => (
							<button
								key={s}
								type="button"
								onClick={() => {
									void handlePromptSubmit(s);
								}}
								className="w-full rounded-md border px-4 py-3 text-left text-sm hover:bg-muted/60"
							>
								{s}
							</button>
						))}
					</div>
				)}
			</div>
		) : (
			messages.map((m, messageIndex) => {
				const isLastMessage = messageIndex === messages.length - 1;

				if (m.role === "assistant") {
					return (
						<AssistantMessage
							key={m.id}
							message={m}
							isLastMessage={isLastMessage}
							status={status}
							regenerate={regenerate}
						/>
					);
				} else {
					return (
						<UserMessage
							key={m.id}
							message={m}
							isLastMessage={isLastMessage}
							status={status}
						/>
					);
				}
			})
		);

	const inputArea = (
		<div
			ref={floatingInput ? inputRef : undefined}
			className={
				floatingInput
					? "absolute bottom-0 left-0 right-0 z-10 px-4 pb-0"
					: "shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 bg-background border-t"
			}
		>
			<div
				className={
					floatingInput
						? "max-w-4xl mx-auto px-4 pb-0 pt-2 bg-background"
						: undefined
				}
			>
				<PromptInput
					accept={supportsImages ? "image/*" : undefined}
					multiple
					globalDrop
					aria-disabled={isLoading || status === "streaming"}
					onSubmit={(message) => {
						void handlePromptSubmit(message.text ?? "", message.files);
					}}
				>
					<PromptInputBody>
						<PromptInputAttachments>
							{(attachment) => <PromptInputAttachment data={attachment} />}
						</PromptInputAttachments>
						<PromptInputTextarea
							ref={textareaRef}
							value={text}
							onChange={(e) => setText(e.currentTarget.value)}
							placeholder="Message"
						/>
					</PromptInputBody>
					<PromptInputToolbar>
						<PromptInputTools>
							<PromptInputActionMenu>
								<PromptInputActionMenuTrigger />
								<PromptInputActionMenuContent>
									<PromptInputActionAddAttachments />
								</PromptInputActionMenuContent>
							</PromptInputActionMenu>
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
													| "21:9",
											)
										}
									>
										<SelectTrigger size="sm" className="min-w-[110px]">
											<SelectValue placeholder="Aspect ratio" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="auto">Auto</SelectItem>
											<SelectItem value="1:1">1:1</SelectItem>
											<SelectItem value="9:16">9:16</SelectItem>
											<SelectItem value="16:9">16:9</SelectItem>
											<SelectItem value="3:4">3:4</SelectItem>
											<SelectItem value="4:3">4:3</SelectItem>
											<SelectItem value="3:2">3:2</SelectItem>
											<SelectItem value="2:3">2:3</SelectItem>
											<SelectItem value="5:4">5:4</SelectItem>
											<SelectItem value="4:5">4:5</SelectItem>
											<SelectItem value="21:9">21:9</SelectItem>
										</SelectContent>
									</Select>
									<Select
										value={imageSize}
										onValueChange={(val) =>
											setImageSize(val as "1K" | "2K" | "4K")
										}
									>
										<SelectTrigger size="sm" className="min-w-[80px]">
											<SelectValue placeholder="Resolution" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="1K">1K</SelectItem>
											<SelectItem value="2K">2K</SelectItem>
											<SelectItem value="4K">4K</SelectItem>
										</SelectContent>
									</Select>
								</>
							)}
							{supportsImageGen && usesPixelDimensions && (
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
							{status === "streaming" ? (
								<PromptInputButton onClick={() => stop()} variant="ghost">
									Stop
								</PromptInputButton>
							) : null}
							<PromptInputSubmit
								status={status === "streaming" ? "streaming" : "ready"}
								disabled={isLoading}
							/>
						</div>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);

	if (floatingInput) {
		return (
			<div className="relative flex flex-col h-full min-h-0">
				<Conversation>
					<ConversationContent
						className="max-w-4xl mx-auto px-4"
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
					<ConversationContent className="px-4 pb-4">
						{messagesContent}
					</ConversationContent>
				</Conversation>
			</div>
			{inputArea}
		</div>
	);
};
