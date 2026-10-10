"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	AlertCircle,
	ArrowUpRight,
	MessagesSquare,
	Play,
	StopCircle,
	RotateCcw,
} from "lucide-react";
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
		return model?.name ?? modelId;
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
			<div className="relative flex flex-1 flex-col min-h-0">
				<div
					ref={scrollRef}
					className="flex-1 overflow-y-auto min-h-0"
					onScroll={handleScroll}
					role="log"
					aria-label="Council discussion"
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
								<div className="mb-7 text-center">
									<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full border border-lounge-gold/30 bg-lounge-gold/[0.08] text-lounge-gold">
										<MessagesSquare className="size-5" />
									</div>
									<p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-lounge-gold">
										The Lounge · Group chat
									</p>
									<h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
										A council of curious minds.
									</h1>
									<p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
										One topic, different perspectives. Your models take turns
										making a case, challenging assumptions, and responding to
										each other.
									</p>
								</div>

								<div className="space-y-4">
									<div>
										<label
											htmlFor="council-topic"
											className="text-sm font-medium mb-2 block"
										>
											Bring a question to the table
										</label>
										<Textarea
											id="council-topic"
											value={initialPrompt}
											onChange={(e) => setInitialPrompt(e.target.value)}
											placeholder="What should your council debate?"
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
											Start discussion
										</Button>
									</div>

									{!canStart && selectedModels.length < 2 && (
										<Alert>
											<AlertCircle className="h-4 w-4" />
											<AlertDescription>
												Invite at least 2 models above to start the discussion.
											</AlertDescription>
										</Alert>
									)}
								</div>

								<div className="mt-5 grid gap-2 sm:grid-cols-2">
									{[
										"Should a small team ship fast or perfect the details?",
										"Is a four-day workweek better for creative work?",
									].map((topic) => (
										<button
											key={topic}
											type="button"
											onClick={() => {
												setInitialPrompt(topic);
												document.getElementById("council-topic")?.focus();
											}}
											className="flex items-start gap-2 rounded-xl border p-3 text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											{topic}
											<ArrowUpRight className="mt-0.5 size-3 shrink-0" />
										</button>
									))}
								</div>
								<p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
									Five turns per round · Stop anytime · Each reply uses credits
									<br />
									This discussion stays here until you leave or reload.
								</p>
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
						<div className="mx-auto max-w-2xl space-y-3">
							<p
								role="status"
								className="text-center text-xs text-muted-foreground"
							>
								{isStreaming
									? "The council is discussing your topic…"
									: "Round paused. Continue for five more turns or bring a new topic."}
							</p>
							<div className="flex flex-wrap gap-2">
								{isStreaming ? (
									<Button
										onClick={onStop}
										variant="destructive"
										className="flex-1"
									>
										<StopCircle className="size-4 mr-2" />
										Stop discussion
									</Button>
								) : (
									<>
										<Button
											onClick={onStart}
											disabled={!canStart}
											className="flex-1"
										>
											<Play className="size-4 mr-2" />
											Continue discussion
										</Button>
										<Button onClick={onClear} variant="outline">
											<RotateCcw className="size-4 mr-2" />
											New discussion
										</Button>
									</>
								)}
							</div>
						</div>
					)}
				</div>
			</div>
		</VirtualScrollContext>
	);
};
