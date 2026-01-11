"use client";
import {
	AlertCircle,
	RefreshCcw,
	Copy,
	Plug,
	Brain,
	GlobeIcon,
} from "lucide-react";
import { useRef, useState } from "react";
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
import { ConnectorsDialog } from "@/components/connectors/connectors-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
	return (
		<div className="flex flex-col h-full min-h-0">
			<div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
				<Conversation>
					<ConversationContent>
						{isLoading && messages.length === 0 ? (
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
										Please select a model that supports image generation to use
										this feature.
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
									const textContent = m.parts
										.filter((p) => p.type === "text")
										.map((p) => p.text)
										.join("");
									const toolParts = m.parts.filter(
										(p) => p.type === "dynamic-tool",
									);
									// Combine all image parts (both image_url and file types)
									const imageParts = m.parts.filter(
										(p: any) =>
											(p.type === "image_url" && p.image_url?.url) ||
											(p.type === "file" && p.mediaType?.startsWith("image/")),
									);
									const reasoningContent = m.parts
										.filter((p) => p.type === "reasoning")
										.map((p) => p.text)
										.join("");
									const sourceParts = m.parts.filter(
										(p) => p.type === "source-url",
									);

									return (
										<div key={m.id}>
											{reasoningContent ? (
												<Reasoning
													className="w-full"
													isStreaming={
														status === "streaming" &&
														m.id === messages.at(-1)?.id
													}
												>
													<ReasoningTrigger />
													<ReasoningContent>
														{reasoningContent}
													</ReasoningContent>
												</Reasoning>
											) : null}

											{toolParts.map((tool) => (
												<Tool key={tool.toolCallId}>
													<ToolHeader
														type={tool.type as `tool-${string}`}
														state={tool.state}
													/>
													<ToolContent>
														<ToolInput input={tool.input} />
														{/* <Confirmation
															approval={tool.approval}
															state={tool.state}
														>
															<ConfirmationTitle>
																<ConfirmationRequest>
																	This tool requires your approval to proceed.
																</ConfirmationRequest>
																<ConfirmationAccepted>
																	<CheckIcon className="size-4 text-green-600 dark:text-green-400" />
																	<span>Accepted</span>
																</ConfirmationAccepted>
																<ConfirmationRejected>
																	<XIcon className="size-4 text-destructive" />
																	<span>Rejected</span>
																</ConfirmationRejected>
															</ConfirmationTitle>
															<ConfirmationActions>
																<ConfirmationAction
																	onClick={async () => {
																		try {
																			addToolApprovalResponse({
																				id: tool.approval!.id,
																				approved: false,
																			});
																		} catch {
																			toast.error("Failed to submit rejection");
																		}
																	}}
																	variant="outline"
																>
																	Reject
																</ConfirmationAction>
																<ConfirmationAction
																	onClick={async () => {
																		try {
																			addToolApprovalResponse({
																				approved: true,
																				id: tool.approval!.id,
																			});
																		} catch {
																			toast.error("Failed to submit approval");
																		}
																	}}
																	variant="default"
																>
																	Accept
																</ConfirmationAction>
															</ConfirmationActions>
														</Confirmation> */}
														<ToolOutput
															errorText={tool.errorText}
															output={tool.output}
														/>
													</ToolContent>
												</Tool>
											))}

											{/* Then assistant text */}
											{textContent ? <Response>{textContent}</Response> : null}

											{/* Images after text */}
											{imageParts.length > 0 ? (
												<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
																	alt={part.name || "Generated image"}
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

											{/* Sources at the bottom */}
											{sourceParts.length > 0 ? (
												<Sources>
													<SourcesTrigger count={sourceParts.length} />
													{sourceParts.map((part, i) => (
														<SourcesContent key={`${m.id}-${i}`}>
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
																await navigator.clipboard.writeText(
																	textContent,
																);
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
								} else {
									// User messages: show text plus any attached images
									const textParts = m.parts
										.filter((p) => p.type === "text")
										.map((p) => p.text);

									const imageParts = (m.parts as any[]).filter(
										(p: any) =>
											p.type === "file" && p.mediaType?.startsWith("image/"),
									);

									return (
										<Message key={m.id} from={m.role}>
											<MessageContent variant="flat">
												{textParts.map((t, idx) => (
													<div key={idx}>{t}</div>
												))}
												{imageParts.length > 0 && (
													<div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
																		alt={part.name || "Uploaded image"}
																		className="h-[300px] aspect-auto border rounded-lg object-cover"
																	/>
																</ImageZoom>
															);
														})}
													</div>
												)}
											</MessageContent>
											{isLastMessage &&
												(status === "submitted" || status === "streaming") && (
													<Loader />
												)}
										</Message>
									);
								}
							})
						)}
					</ConversationContent>
				</Conversation>
			</div>

			<div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 bg-background border-t">
				{error && (
					<Alert variant="destructive" className="mb-4">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<PromptInput
					accept={supportsImages ? "image/*" : undefined}
					multiple
					globalDrop
					aria-disabled={isLoading || status === "streaming"}
					onSubmit={(message) => {
						// Fire-and-forget so PromptInput can clear attachments immediately.
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
							<ConnectorsDialog
								trigger={
									<PromptInputButton variant="ghost">
										<Plug size={16} />
										<span>MCPs</span>
									</PromptInputButton>
								}
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
};
