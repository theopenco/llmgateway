"use client";

import { getModelStreamingSupport } from "@llmgateway/models";
import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";

import { ApiKeyManager } from "@/components/playground/api-key-manager";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatHeader } from "@/components/playground/chat-header";
import { ChatUi } from "@/components/playground/chat-ui";
import { ChatSidebar } from "@/components/playground/sidebar";
import { useApiKey } from "@/hooks/useApiKey";
import {
	useCreateChat,
	useAddMessage,
	useChat,
	useChats,
} from "@/hooks/useChats";
import { useUser } from "@/hooks/useUser";
import { Alert, AlertDescription } from "@/lib/components/alert";
import { SidebarProvider } from "@/lib/components/sidebar";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

export interface Message {
	id: string;
	role: "user" | "assistant" | "system";
	content: string | null;
	timestamp: Date;
	images?: Array<{
		type: "image_url";
		image_url: {
			url: string;
		};
	}>;
}

export function PlaygroundClient() {
	const config = useAppConfig();
	const { user, isLoading: isUserLoading } = useUser();
	const { userApiKey, isLoaded: isApiKeyLoaded } = useApiKey();
	const router = useRouter();
	const searchParams = useSearchParams();
	const api = useApi();
	const queryClient = useQueryClient();

	// Get initial model from URL or default
	const getInitialModel = () => {
		const modelFromUrl = searchParams.get("model");
		return modelFromUrl || "gpt-4o-mini";
	};

	const [selectedModel, setSelectedModel] = useState(getInitialModel());

	const [messages, setMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentChatId, setCurrentChatId] = useState<string | null>(null);

	// Chat API hooks
	const createChat = useCreateChat();
	const addMessage = useAddMessage();
	const { data: currentChatData } = useChat(currentChatId ?? "");
	useChats();
	const { data: subscriptionStatus, isLoading: isSubscriptionLoading } =
		api.useQuery("get", "/subscriptions/status", {});
	const { data: orgsData, isLoading: isOrgsLoading } = api.useQuery(
		"get",
		"/orgs",
	);

	const [showApiKeyManager, setShowApiKeyManager] = useState(false);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isUserLoading && !user;

	useEffect(() => {
		if (isApiKeyLoaded && !userApiKey && !showAuthDialog) {
			setShowApiKeyManager(true);
		}
	}, [isApiKeyLoaded, userApiKey, showAuthDialog]);

	useEffect(() => {
		if (currentChatData?.messages) {
			const chatMessages: Message[] = currentChatData.messages.map((msg) => ({
				id: msg.id,
				role: msg.role,
				content: msg.content,
				timestamp: new Date(msg.createdAt),
				images: msg.images
					? (() => {
							try {
								return JSON.parse(msg.images);
							} catch (error) {
								console.warn("Failed to parse images JSON:", msg.images, error);
								return undefined;
							}
						})()
					: undefined,
			}));

			// Preserve images from existing local messages when reloading from database
			setMessages((prevMessages) => {
				const updatedMessages = chatMessages.map((dbMsg) => {
					// Try to match by ID first, then by content and role as fallback
					let existingMsg = prevMessages.find((m) => m.id === dbMsg.id);

					if (!existingMsg) {
						// If no ID match, try to find by content and role (for cases where DB assigns new IDs)
						existingMsg = prevMessages.find(
							(m) =>
								m.content === dbMsg.content &&
								m.role === dbMsg.role &&
								m.images &&
								m.images.length > 0, // Only match if the local message has images
						);
					}

					return {
						...dbMsg,
						// Preserve images if they exist in the local state
						...(existingMsg?.images ? { images: existingMsg.images } : {}),
					};
				});

				return updatedMessages;
			});
		} else if (currentChatData !== undefined) {
			// Chat exists but has no messages, clear the message state
			setMessages([]);
		}
	}, [currentChatData]);

	// Update URL when model changes
	useEffect(() => {
		const currentParams = new URLSearchParams(searchParams.toString());
		if (selectedModel !== "gpt-4o-mini") {
			currentParams.set("model", selectedModel);
		} else {
			currentParams.delete("model");
		}

		const newUrl = currentParams.toString()
			? `${window.location.pathname}?${currentParams.toString()}`
			: window.location.pathname;

		router.replace(newUrl);
	}, [selectedModel, router, searchParams]);

	// Sync with URL changes (back/forward navigation)
	useEffect(() => {
		const modelFromUrl = searchParams.get("model");
		const targetModel = modelFromUrl || "gpt-4o-mini";
		if (targetModel !== selectedModel) {
			setSelectedModel(targetModel);
		}
	}, [searchParams, selectedModel]);

	const handleModelSelect = (model: string) => {
		setSelectedModel(model);
	};

	const addLocalMessage = (message: Omit<Message, "id" | "timestamp">) => {
		const newMessage: Message = {
			...message,
			id: Date.now().toString(),
			timestamp: new Date(),
		};
		setMessages((prev) => [...prev, newMessage]);
		return newMessage;
	};

	const ensureCurrentChat = async (userMessage?: string): Promise<string> => {
		if (currentChatId) {
			return currentChatId;
		}

		try {
			const title = userMessage
				? userMessage.slice(0, 50) + (userMessage.length > 50 ? "..." : "")
				: "New Chat";

			const chatData = await createChat.mutateAsync({
				body: {
					title,
					model: selectedModel,
				},
			});
			const newChatId = chatData.chat.id;
			setCurrentChatId(newChatId);
			return newChatId;
		} catch (error) {
			console.error("Failed to create chat:", error);
			setError("Failed to create a new chat. Please try again.");
			throw error;
		}
	};

	const handleSendMessage = async (content: string) => {
		if (!isAuthenticated || !content.trim()) {
			return;
		}

		if (!isApiKeyLoaded || isSubscriptionLoading || isOrgsLoading) {
			return;
		}

		if (!userApiKey) {
			setShowApiKeyManager(true);
			return;
		}

		// Check if user has pro plan or enough credits
		if (subscriptionStatus?.plan === "pro") {
			// For pro users, check if subscription is expired or cancelled
			if (
				subscriptionStatus.subscriptionCancelled ||
				(subscriptionStatus.planExpiresAt &&
					new Date(subscriptionStatus.planExpiresAt) < new Date())
			) {
				setError(
					"Your pro subscription has expired or been cancelled. Please renew your subscription or purchase credits.",
				);
				return;
			}
		} else if (subscriptionStatus) {
			// only evaluate when the call succeeded
			const org = orgsData?.organizations?.[0];
			const credits = parseFloat(org?.credits ?? "0");
			if (!org || Number.isNaN(credits) || credits <= 0) {
				setError("You don't have enough credits to send this message.");
				return;
			}
		} else {
			setError("Unable to verify subscription status. Please retry.");
			return;
		}

		setIsLoading(true);
		addLocalMessage({ role: "user", content });

		try {
			const chatId = await ensureCurrentChat(content);

			await addMessage.mutateAsync({
				params: {
					path: { id: chatId },
				},
				body: { role: "user", content },
			});

			const supportsStreaming = getModelStreamingSupport(selectedModel);

			const requestPayload = {
				model: selectedModel,
				messages: [...messages, { role: "user", content }].map((msg) => ({
					role: msg.role,
					content: msg.content,
				})),
				stream: supportsStreaming,
				apiKey: userApiKey,
			};

			const response = await fetch(config.apiUrl + "/chat/completion", {
				credentials: "include",
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(requestPayload),
			});

			if (!response.ok) {
				const errorText = await response.text();
				try {
					const errorJson = JSON.parse(errorText);
					if (errorJson.error) {
						setError(errorJson.error);
						throw new Error(errorJson.error);
					}
				} catch {
					setError(`HTTP ${response.status}: ${errorText || "Unknown error"}`);
					throw new Error(`HTTP ${response.status}: ${errorText}`);
				}
			}

			if (supportsStreaming) {
				const assistantMessage = addLocalMessage({
					role: "assistant",
					content: "",
				});

				const reader = response.body?.getReader();
				const decoder = new TextDecoder();
				let fullContent = "";
				let finalImages: any[] = []; // Track final images received during streaming
				let hasReceivedImages = false; // Track if we received images during streaming

				if (reader) {
					let buffer = "";
					try {
						while (true) {
							const { done, value } = await reader.read();
							if (done) {
								break;
							}

							buffer += decoder.decode(value, { stream: true });
							const lines = buffer.split("\n");
							buffer = lines.pop() || "";

							for (const line of lines) {
								if (line.startsWith("data: ")) {
									const data = line.slice(6).trim();
									if (data === "[DONE]") {
										continue;
									}

									try {
										const parsed = JSON.parse(data);
										const delta = parsed.choices?.[0]?.delta?.content;
										const images = parsed.choices?.[0]?.message?.images;
										const deltaImages = parsed.choices?.[0]?.delta?.images;

										// Determine what images to use (delta images take precedence)
										let imagesToSet: any[] | undefined;
										if (deltaImages && deltaImages.length > 0) {
											imagesToSet = deltaImages;
											finalImages = [...deltaImages]; // Track final images
											hasReceivedImages = true; // Mark that we received images
										} else if (images && images.length > 0) {
											imagesToSet = images;
											finalImages = [...images]; // Track final images
											hasReceivedImages = true; // Mark that we received images
										}

										// Apply updates if there are any changes
										if (delta || imagesToSet) {
											if (delta) {
												fullContent += delta;
											}

											setMessages((prev) =>
												prev.map((msg) => {
													if (msg.id === assistantMessage.id) {
														const updatedMsg = { ...msg };

														// Update content if delta exists
														if (delta) {
															updatedMsg.content = msg.content + delta;
														}

														// Update images if new ones are provided, otherwise preserve existing
														if (imagesToSet) {
															updatedMsg.images = imagesToSet;
														}
														// Note: if imagesToSet is undefined, we preserve existing msg.images

														return updatedMsg;
													}
													return msg;
												}),
											);
										}
									} catch {
										console.warn("Failed to parse streaming data:", data);
									}
								}
							}
						}
					} finally {
						reader.releaseLock();
					}
				}

				// Save the complete assistant response to database
				if ((fullContent || finalImages.length > 0) && chatId) {
					try {
						await addMessage.mutateAsync({
							params: {
								path: { id: chatId },
							},
							body: {
								role: "assistant",
								content: fullContent || undefined,
								images:
									finalImages.length > 0
										? JSON.stringify(finalImages)
										: undefined,
							},
						});

						// Only invalidate query if no images were received (to avoid overwriting image data with DB data)
						if (!hasReceivedImages) {
							const queryKey = api.queryOptions("get", "/chats/{id}", {
								params: { path: { id: chatId } },
							}).queryKey;
							queryClient.invalidateQueries({ queryKey });
						}
					} catch (error) {
						console.error("Failed to save assistant message:", error);
					}
				}
			} else {
				const data = await response.json();

				const assistantContent = data.content ?? undefined;
				const assistantImages = data.images || [];

				addLocalMessage({
					role: "assistant",
					content: assistantContent,
					images: assistantImages.length > 0 ? assistantImages : undefined,
				});

				// Save the assistant response to database
				if ((assistantContent || assistantImages.length > 0) && chatId) {
					try {
						await addMessage.mutateAsync({
							params: {
								path: { id: chatId },
							},
							body: {
								role: "assistant",
								content: assistantContent,
								images:
									assistantImages.length > 0
										? JSON.stringify(assistantImages)
										: undefined,
							},
						});

						// Only invalidate query if no images (to avoid overwriting image data with DB data)
						if (assistantImages.length === 0) {
							const queryKey = api.queryOptions("get", "/chats/{id}", {
								params: { path: { id: chatId } },
							}).queryKey;
							queryClient.invalidateQueries({ queryKey });
						}
					} catch (error) {
						console.error("Failed to save assistant message:", error);
					}
				}
			}

			setError(null);
		} catch (error) {
			console.error("Error sending message:", error);
			if (error instanceof Error && !error.message.includes("HTTP")) {
				setError("Failed to send message. Please try again.");
			}
		} finally {
			setIsLoading(false);
		}
	};

	const clearMessages = () => {
		setMessages([]);
		setCurrentChatId(null);
		setError(null);
	};

	const handleNewChat = async () => {
		setMessages([]);
		setCurrentChatId(null);
		setError(null);
	};

	const handleChatSelect = (chatId: string) => {
		setCurrentChatId(chatId);
		setError(null);
		// Clear messages immediately to avoid showing stale data while loading
		setMessages([]);
	};

	return (
		<SidebarProvider>
			<div className="flex h-screen bg-background w-full">
				<ChatSidebar
					onNewChat={handleNewChat}
					onChatSelect={handleChatSelect}
					currentChatId={currentChatId || undefined}
					clearMessages={clearMessages}
					userApiKey={userApiKey}
				/>
				<div className="flex flex-1 flex-col w-full">
					<ChatHeader
						selectedModel={selectedModel}
						onModelSelect={handleModelSelect}
						onManageApiKey={() => setShowApiKeyManager(true)}
					/>
					<div className="max-w-2xl mx-auto px-4 pt-4">
						<Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950 dark:border-blue-800">
							<Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
							<AlertDescription className="text-blue-800 dark:text-blue-200">
								We're revamping the playground. Stay tuned for V2!
							</AlertDescription>
						</Alert>
					</div>
					<div className="flex-1 max-w-2xl mx-auto">
						<ChatUi
							messages={messages}
							onSendMessage={handleSendMessage}
							isLoading={isLoading}
							error={error}
							onClearMessages={() => setMessages([])}
						/>
					</div>
				</div>
			</div>

			<AuthDialog open={showAuthDialog} />
			<ApiKeyManager
				open={showApiKeyManager}
				onOpenChange={setShowApiKeyManager}
				selectedModel={selectedModel}
			/>
		</SidebarProvider>
	);
}
