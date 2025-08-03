import { format } from "date-fns";
import {
	Send,
	Bot,
	User,
	AlertCircle,
	Trash2,
	Copy,
	CheckCircle,
	Lightbulb,
	Code,
	FileText,
	MessageCircle,
} from "lucide-react";
import { useRef, useEffect, useState } from "react";

import { Alert, AlertDescription } from "@/lib/components/alert";
import { Avatar, AvatarFallback } from "@/lib/components/avatar";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { ScrollArea } from "@/lib/components/scroll-area";
import { Textarea } from "@/lib/components/textarea";
import { toast } from "@/lib/components/use-toast";
import { cn } from "@/lib/utils";

interface MessageType {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: Date;
}

interface ChatUiProps {
	messages: MessageType[];
	isLoading: boolean;
	error: string | null;
	onSendMessage: (content: string) => Promise<void>;
	onClearMessages: () => void;
	className?: string;
}

const STARTER_PROMPTS = [
	{
		icon: Code,
		title: "Code Review",
		prompt:
			"Can you review this JavaScript function and suggest improvements?\n\n```javascript\nfunction calculateTotal(items) {\n  let total = 0;\n  for(let i = 0; i < items.length; i++) {\n    total += items[i].price;\n  }\n  return total;\n}\n```",
	},
	{
		icon: FileText,
		title: "Explain Concept",
		prompt:
			"Can you explain the concept of microservices architecture and when it's beneficial to use?",
	},
	{
		icon: Lightbulb,
		title: "Creative Writing",
		prompt:
			"Write a short story about an AI that discovers it can dream. Make it thoughtful and engaging.",
	},
	{
		icon: MessageCircle,
		title: "Problem Solving",
		prompt:
			"I'm planning a cross-country road trip for 2 weeks. Can you help me create an itinerary with must-see destinations and practical tips?",
	},
];

export function ChatUi({
	messages,
	isLoading,
	error,
	onSendMessage,
	onClearMessages,
	className,
}: ChatUiProps) {
	const [input, setInput] = useState("");
	const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
	const scrollAreaRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	// Auto-scroll to bottom when new messages arrive or content updates
	useEffect(() => {
		if (scrollAreaRef.current) {
			const scrollContainer = scrollAreaRef.current.querySelector(
				"[data-radix-scroll-area-viewport]",
			);
			if (scrollContainer) {
				scrollContainer.scrollTop = scrollContainer.scrollHeight;
			}
		}
	}, [messages]);

	// Focus textarea on mount
	useEffect(() => {
		textareaRef.current?.focus();
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim() || isLoading) {
			return;
		}

		const messageContent = input.trim();
		setInput("");
		await onSendMessage(messageContent);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			handleSubmit(e);
		}
	};

	const handleStarterPrompt = async (prompt: string) => {
		setInput(prompt);
		textareaRef.current?.focus();
	};

	const copyToClipboard = async (content: string, messageId: string) => {
		try {
			await navigator.clipboard.writeText(content);
			setCopiedMessageId(messageId);
			toast({
				description: "Message copied to clipboard",
			});
			setTimeout(() => setCopiedMessageId(null), 2000);
		} catch {
			toast({
				description: "Failed to copy message",
				variant: "destructive",
			});
		}
	};

	const formatTime = (date: Date) => {
		return format(date, "HH:mm");
	};

	return (
		<div className={cn("flex flex-col h-full", className)}>
			{/* Error Alert */}
			{error && (
				<div className="p-4 border-b">
					<Alert variant="destructive">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				</div>
			)}

			{/* Chat Messages */}
			<ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
				{messages.length === 0 ? (
					<div className="flex items-center justify-center h-full">
						<div className="w-full space-y-8">
							{/* Welcome Section */}
							<div className="text-center space-y-4">
								<Bot className="h-16 w-16 mx-auto text-muted-foreground/50" />
								<div>
									<h3 className="text-2xl font-semibold mb-2 text-foreground">
										Welcome to LLM Gateway Playground
									</h3>
									<p className="text-muted-foreground">
										Start a conversation with AI. Ask questions, get help with
										code, brainstorm ideas, or explore creative writing.
									</p>
								</div>
								<div className="flex gap-2 justify-center">
									<Badge
										variant="outline"
										className="text-xs border-muted-foreground/20"
									>
										Streaming
									</Badge>
									<Badge
										variant="outline"
										className="text-xs border-muted-foreground/20"
									>
										Multiple Models
									</Badge>
									<Badge
										variant="outline"
										className="text-xs border-muted-foreground/20"
									>
										Real-time
									</Badge>
								</div>
							</div>

							{/* Starter Prompts */}
							<div className="space-y-4">
								<h4 className="text-lg font-medium text-center">
									Try these to get started
								</h4>
								<div className="grid gap-3 md:grid-cols-2">
									{STARTER_PROMPTS.map((prompt, index) => {
										const IconComponent = prompt.icon;
										return (
											<Button
												key={index}
												variant="outline"
												type="button"
												className="h-auto p-4 text-left justify-start hover:bg-muted/50 transition-colors border-muted-foreground/20"
												onClick={() => handleStarterPrompt(prompt.prompt)}
											>
												<div className="flex gap-3 w-full">
													<IconComponent className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
													<div className="min-w-0">
														<div className="font-medium text-sm">
															{prompt.title}
														</div>
														<div className="text-xs text-muted-foreground line-clamp-2 mt-1">
															{prompt.prompt.length > 80
																? prompt.prompt.substring(0, 80) + "..."
																: prompt.prompt}
														</div>
													</div>
												</div>
											</Button>
										);
									})}
								</div>
							</div>
						</div>
					</div>
				) : (
					<div className="space-y-6 w-full">
						{messages.map((message) => (
							<div
								key={message.id}
								className={`flex gap-4 group ${
									message.role === "user" ? "flex-row-reverse" : ""
								}`}
							>
								<Avatar className="h-8 w-8 shrink-0">
									<AvatarFallback
										className={
											message.role === "user"
												? "bg-foreground text-background"
												: "bg-muted text-muted-foreground"
										}
									>
										{message.role === "user" ? (
											<User className="h-4 w-4" />
										) : (
											<Bot className="h-4 w-4" />
										)}
									</AvatarFallback>
								</Avatar>

								<div
									className={`flex-1 space-y-2 ${
										message.role === "user" ? "text-right" : ""
									}`}
								>
									<div className="flex items-center gap-2">
										<div
											className={`text-sm font-medium ${
												message.role === "user" ? "order-2" : ""
											}`}
										>
											{message.role === "user" ? "You" : "Assistant"}
										</div>
										<div
											className={`text-xs text-muted-foreground ${
												message.role === "user" ? "order-1" : ""
											}`}
										>
											{formatTime(message.timestamp)}
										</div>
									</div>

									<div
										className={`relative group/message ${
											message.role === "user" ? "flex justify-end" : ""
										}`}
									>
										<div
											className={`prose prose-sm max-w-none dark:prose-invert p-4 rounded-lg ${
												message.role === "user"
													? "bg-foreground text-background prose-invert max-w-[80%]"
													: "bg-background border shadow-sm max-w-full"
											}`}
										>
											<div className="whitespace-pre-wrap font-sans text-sm leading-relaxed break-words">
												{message.content}
											</div>
										</div>

										{/* Copy button */}
										{message.content && (
											<Button
												variant="ghost"
												size="sm"
												className={`absolute -bottom-8 opacity-0 group-hover/message:opacity-100 transition-opacity ${
													message.role === "user" ? "right-0" : "left-0"
												}`}
												onClick={() =>
													copyToClipboard(message.content, message.id)
												}
											>
												{copiedMessageId === message.id ? (
													<CheckCircle className="h-3 w-3" />
												) : (
													<Copy className="h-3 w-3" />
												)}
											</Button>
										)}
									</div>
								</div>
							</div>
						))}

						{/* Loading indicator */}
						{isLoading && (
							<div className="flex gap-4">
								<Avatar className="h-8 w-8 shrink-0">
									<AvatarFallback className="bg-muted text-muted-foreground">
										<Bot className="h-4 w-4" />
									</AvatarFallback>
								</Avatar>
								<div className="flex-1">
									<div className="flex items-center gap-1 p-4 bg-background border rounded-lg shadow-sm w-fit">
										<div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" />
										<div
											className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
											style={{ animationDelay: "0.1s" }}
										/>
										<div
											className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"
											style={{ animationDelay: "0.2s" }}
										/>
									</div>
								</div>
							</div>
						)}
					</div>
				)}
			</ScrollArea>

			{/* Input Form */}
			<div className="border-t bg-background p-4">
				<div className="w-full">
					{/* Clear button */}
					{messages.length > 0 && (
						<div className="flex justify-end mb-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={onClearMessages}
								className="text-muted-foreground hover:text-foreground"
							>
								<Trash2 className="h-3 w-3 mr-1" />
								Clear conversation
							</Button>
						</div>
					)}

					<form onSubmit={handleSubmit} className="relative">
						<Textarea
							ref={textareaRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
							className="min-h-[80px] max-h-[200px] resize-none pr-12 bg-background border-muted-foreground/20"
							disabled={isLoading}
						/>
						<Button
							type="submit"
							size="sm"
							disabled={!input.trim() || isLoading}
							className="absolute bottom-2 right-2 h-8 w-8 p-0"
						>
							<Send className="h-4 w-4" />
						</Button>
					</form>

					<div className="text-xs text-muted-foreground mt-2 text-center">
						This Playground can make mistakes. Consider checking important
						information.
					</div>
				</div>
			</div>
		</div>
	);
}
