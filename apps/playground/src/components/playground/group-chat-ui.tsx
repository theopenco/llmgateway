"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { AlertCircle, Play, StopCircle, Trash2 } from "lucide-react";
import { useRef, useState, useEffect, useCallback, useMemo } from "react";

import {
	ConversationScrollButton,
	VirtualScrollContext,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { Response } from "@/components/ai-elements/response";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

import type { ComboboxModel } from "@/lib/types";

interface GroupMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	model?: string;
	timestamp: number;
}

interface GroupChatUIProps {
	messages: GroupMessage[];
	isStreaming: boolean;
	error: string | null;
	initialPrompt: string;
	setInitialPrompt: (prompt: string) => void;
	onStart: () => void;
	onStop: () => void;
	onClear: () => void;
	selectedModels: string[];
	availableModels: ComboboxModel[];
	canStart: boolean;
}

const MESSAGE_ESTIMATE_SIZE = 74;

export const GroupChatUI = ({
	messages,
	isStreaming,
	error,
	initialPrompt,
	setInitialPrompt,
	onStart,
	onStop,
	onClear,
	selectedModels,
	availableModels,
	canStart,
}: GroupChatUIProps) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [isAtEnd, setIsAtEnd] = useState(true);
	const wasAtEndRef = useRef(true);

	const virtualizer = useVirtualizer({
		count: messages.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => MESSAGE_ESTIMATE_SIZE,
		getItemKey: (index) => messages[index]!.id,
		anchorTo: "end",
		followOnAppend: true,
		scrollEndThreshold: 80,
		overscan: 6,
	});

	const virtualizerRef = useRef(virtualizer);
	virtualizerRef.current = virtualizer;
	const totalSize = virtualizer.getTotalSize();

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		const virtNext = virtualizerRef.current.isAtEnd(80);
		const domNext = el
			? el.scrollHeight - el.scrollTop - el.clientHeight < 80
			: virtNext;
		wasAtEndRef.current = domNext;
		setIsAtEnd((prev) => (prev === domNext ? prev : domNext));
	}, []);

	const scrollToEnd = useCallback(() => {
		virtualizerRef.current.scrollToEnd();
	}, []);

	useEffect(() => {
		if (messages.length > 0 && wasAtEndRef.current) {
			requestAnimationFrame(() => virtualizerRef.current.scrollToEnd());
		}
	}, [totalSize, messages.length]);

	useEffect(() => {
		if (isStreaming) {
			requestAnimationFrame(() => virtualizerRef.current.scrollToEnd());
		}
	}, [isStreaming]);

	const getModelLabel = (modelId?: string) => {
		if (!modelId) {
			return "Unknown";
		}
		const model = availableModels.find((m) => m.id === modelId);
		return model?.id ?? modelId;
	};

	const getModelColor = (modelId?: string) => {
		if (!modelId) {
			return "bg-gray-500";
		}
		const index = selectedModels.indexOf(modelId);
		const colors = [
			"bg-blue-500",
			"bg-green-500",
			"bg-purple-500",
			"bg-orange-500",
			"bg-pink-500",
		];
		return colors[index] || "bg-gray-500";
	};

	const virtualScrollContextValue = useMemo(
		() => ({ isAtEnd, scrollToEnd }),
		[isAtEnd, scrollToEnd],
	);

	return (
		<VirtualScrollContext value={virtualScrollContextValue}>
			<div className="flex flex-col h-full min-h-0">
				<div
					ref={scrollRef}
					className="flex-1 overflow-y-auto min-h-0"
					onScroll={handleScroll}
					role="log"
				>
					<div
						className={`mx-auto max-w-2xl relative ${
							messages.length === 0
								? "flex min-h-full items-center justify-center px-4"
								: ""
						}`}
						style={
							messages.length > 0
								? { height: virtualizer.getTotalSize() }
								: { minHeight: "100%" }
						}
					>
						{messages.length === 0 ? (
							<div className="py-10 w-full">
								<div className="mb-6 text-center">
									<h2 className="text-3xl font-semibold tracking-tight mb-2">
										Group Chat Mode
									</h2>
									<p className="text-muted-foreground">
										Watch different AI models discuss and collaborate on your
										prompt
									</p>
								</div>

								<div className="space-y-4">
									<div>
										<label className="text-sm font-medium mb-2 block">
											Initial Prompt
										</label>
										<Textarea
											value={initialPrompt}
											onChange={(e) => setInitialPrompt(e.target.value)}
											placeholder="Enter a topic or question for the models to discuss... (e.g., 'What are the pros and cons of functional programming?')"
											className="min-h-[120px]"
											disabled={isStreaming}
										/>
									</div>

									<div className="flex gap-2">
										<Button
											onClick={onStart}
											disabled={!canStart || !initialPrompt.trim()}
											className="flex-1"
										>
											<Play className="size-4 mr-2" />
											Start Conversation
										</Button>
									</div>

									{!canStart && selectedModels.length < 2 && (
										<Alert>
											<AlertCircle className="h-4 w-4" />
											<AlertDescription>
												Please select at least 2 models to start a group
												conversation
											</AlertDescription>
										</Alert>
									)}
								</div>

								<div className="mt-8 p-4 rounded-lg border bg-muted/50">
									<h3 className="font-medium mb-2">How it works</h3>
									<ul className="text-sm text-muted-foreground space-y-1">
										<li>• Add 2-5 different AI models to the conversation</li>
										<li>
											• Enter your initial prompt or question to kick off the
											discussion
										</li>
										<li>
											• Models will take turns responding to each other in
											sequence
										</li>
										<li>
											• Each model builds on the previous responses, creating a
											dynamic conversation
										</li>
										<li>
											• You can stop the conversation at any time and start a
											new one
										</li>
									</ul>
								</div>
							</div>
						) : (
							virtualizer.getVirtualItems().map((item) => {
								const message = messages[item.index]!;
								const isLastMessage = item.index === messages.length - 1;

								return (
									<div
										key={item.key}
										data-index={item.index}
										ref={virtualizer.measureElement}
										className="px-4 py-2"
										style={{
											position: "absolute",
											top: 0,
											left: 0,
											transform: `translateY(${item.start}px)`,
											width: "100%",
										}}
									>
										{message.role === "user" ? (
											<Message from="user">
												<MessageContent variant="flat">
													<div>{message.content}</div>
												</MessageContent>
											</Message>
										) : (
											<div className="mb-2">
												<div className="flex items-center gap-2 mb-2">
													<div
														className={`w-2 h-2 rounded-full ${getModelColor(message.model)}`}
													/>
													<span className="text-xs font-medium text-muted-foreground">
														{getModelLabel(message.model)}
													</span>
												</div>
												<Response isStreaming={isStreaming && isLastMessage}>
													{message.content}
												</Response>
												{isLastMessage && isStreaming && <Loader />}
											</div>
										)}
									</div>
								);
							})
						)}
					</div>
				</div>
				<ConversationScrollButton />

				<div className="shrink-0 px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-2 bg-background border-t">
					{error && (
						<Alert variant="destructive" className="mb-4">
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					)}

					{messages.length > 0 && (
						<div className="flex gap-2">
							{isStreaming ? (
								<Button
									onClick={onStop}
									variant="destructive"
									className="flex-1"
								>
									<StopCircle className="size-4 mr-2" />
									Stop Conversation
								</Button>
							) : (
								<>
									<Button
										onClick={onStart}
										disabled={!canStart}
										className="flex-1"
									>
										<Play className="size-4 mr-2" />
										Continue Conversation
									</Button>
									<Button onClick={onClear} variant="outline">
										<Trash2 className="size-4 mr-2" />
										Clear
									</Button>
								</>
							)}
						</div>
					)}
				</div>
			</div>
		</VirtualScrollContext>
	);
};
