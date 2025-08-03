"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { ApiKeyManager } from "./playground/api-key-manager";
import { ChatHeader } from "./playground/chat-header";
import { Button } from "@/lib/components/button";
import { Card } from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { ScrollArea } from "@/lib/components/scroll-area";
import { toast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";

interface Message {
	role: "user" | "assistant";
	content: string;
}

export function Chat() {
	const config = useAppConfig();
	const [messages, setMessages] = useState<Message[]>([]);
	const [input, setInput] = useState("");
	const [isLoading, setIsLoading] = useState(false);
	const [selectedModel, setSelectedModel] = useState("gpt-4.1");
	const [showApiKeyManager, setShowApiKeyManager] = useState(false);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault();
		if (!input.trim() || isLoading) {
			return;
		}

		const userMessage: Message = {
			role: "user",
			content: input.trim(),
		};

		setMessages((prev) => [...prev, userMessage]);
		setInput("");
		setIsLoading(true);

		try {
			const response = await fetch(config.apiUrl + "/chat/completion", {
				credentials: "include",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					messages: [...messages, userMessage],
					model: selectedModel,
				}),
			});

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				const errorMessage =
					errorData.message || `Server error: ${response.status}`;
				throw new Error(errorMessage);
			}

			const data = await response.json();
			setMessages((prev) => [
				...prev,
				{ role: "assistant", content: data.content },
			]);
		} catch (error) {
			console.error("Chat error:", error);

			// Show user-friendly error message
			const errorMessage =
				error instanceof Error ? error.message : "An unexpected error occurred";
			toast({
				title: "Chat Error",
				description: errorMessage,
				variant: "destructive",
			});

			// Remove the user message that failed to get a response
			setMessages((prev) => prev.slice(0, -1));
		} finally {
			setIsLoading(false);
		}
	};

	const handleModelSelect = (model: string) => {
		setSelectedModel(model);
	};

	return (
		<div className="flex flex-col h-full">
			<ChatHeader
				selectedModel={selectedModel}
				onModelSelect={handleModelSelect}
				onManageApiKey={() => setShowApiKeyManager(true)}
			/>
			<Card className="flex-1 mx-4 my-4 p-4">
				<ScrollArea className="h-[calc(100vh-12rem)] pr-4">
					<div className="space-y-4">
						{messages.map((message, index) => (
							<div
								key={index}
								className={`flex ${
									message.role === "user" ? "justify-end" : "justify-start"
								}`}
							>
								<div
									className={`max-w-[80%] rounded-lg p-4 ${
										message.role === "user"
											? "bg-primary text-primary-foreground"
											: "bg-muted"
									}`}
								>
									{message.content}
								</div>
							</div>
						))}
						{isLoading && (
							<div className="flex justify-start">
								<div className="bg-muted rounded-lg p-4">
									<Loader2 className="h-4 w-4 animate-spin" />
								</div>
							</div>
						)}
					</div>
				</ScrollArea>
				<form onSubmit={handleSubmit} className="mt-4 flex gap-2">
					<Input
						value={input}
						onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
							setInput(e.target.value)
						}
						placeholder="Type your message..."
						disabled={isLoading}
					/>
					<Button type="submit" disabled={isLoading}>
						Send
					</Button>
				</form>
			</Card>
			<ApiKeyManager
				open={showApiKeyManager}
				onOpenChange={setShowApiKeyManager}
			/>
		</div>
	);
}
