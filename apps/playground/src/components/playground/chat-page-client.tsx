"use client";

import { useChat } from "@ai-sdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";

import { ApiKeyManager } from "@/components/playground/api-key-manager";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatHeader } from "@/components/playground/chat-header";
import { ChatSidebar } from "@/components/playground/chat-sidebar";
import { ChatUI } from "@/components/playground/chat-ui";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useApiKey } from "@/hooks/useApiKey";
import {
	useAddMessage,
	useChats,
	useCreateChat,
	useDataChat,
} from "@/hooks/useChats";
import { useUser } from "@/hooks/useUser";
import { mapModels } from "@/lib/mapmodels";

import type { ComboboxModel } from "@/lib/types";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

interface ChatPageClientProps {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
}

export default function ChatPageClient({
	models,
	providers,
}: ChatPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const { userApiKey, isLoaded: isApiKeyLoaded } = useApiKey();
	const router = useRouter();
	const searchParams = useSearchParams();

	const mapped = useMemo(
		() => mapModels(models, providers),
		[models, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	const getInitialModel = () => {
		const modelFromUrl = searchParams.get("model");
		return modelFromUrl || "gpt-5";
	};

	const [selectedModel, setSelectedModel] = useState(getInitialModel());
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentChatId, setCurrentChatId] = useState<string | null>(null);
	const chatIdRef = useRef(currentChatId);

	const { messages, setMessages, sendMessage, status, stop, regenerate } =
		useChat({
			onError: (e) => {
				setError(e.message);
			},
			onFinish: async ({ message }) => {
				const chatId = chatIdRef.current;
				if (!chatId) {
					return;
				}
				await addMessage.mutateAsync({
					params: { path: { id: chatId } },
					body: {
						role: "assistant",
						content: message.parts
							.filter((p) => p.type === "text")
							.map((p) => p.text)
							.join(""),
					},
				});
			},
		});

	useEffect(() => {
		chatIdRef.current = currentChatId;
	}, [currentChatId]);

	// Chat API hooks
	const createChat = useCreateChat();
	const addMessage = useAddMessage();
	const { data: currentChatData } = useDataChat(currentChatId ?? "");
	useChats();

	useEffect(() => {
		if (!currentChatData?.messages) {
			return;
		}

		setMessages((prev) => {
			if (prev.length === 0) {
				return currentChatData.messages.map((msg) => ({
					id: msg.id,
					role: msg.role,
					content: msg.content ?? "",
					parts: [{ type: "text", text: msg.content ?? "" }],
				}));
			}
			return prev;
		});
	}, [currentChatData, setMessages]);

	const [showApiKeyManager, setShowApiKeyManager] = useState(false);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	useEffect(() => {
		if (isApiKeyLoaded && !userApiKey && !showAuthDialog) {
			setShowApiKeyManager(true);
		}
	}, [isApiKeyLoaded, userApiKey, showAuthDialog]);

	const ensureCurrentChat = async (userMessage?: string): Promise<string> => {
		if (chatIdRef.current) {
			return chatIdRef.current;
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
			chatIdRef.current = newChatId; // Manually update the ref
			return newChatId;
		} catch (error) {
			setError("Failed to create a new chat. Please try again.");
			throw error;
		}
	};

	const handleUserMessage = async (content: string) => {
		setError(null);
		setIsLoading(true);

		try {
			const chatId = await ensureCurrentChat(content);

			await addMessage.mutateAsync({
				params: { path: { id: chatId } },
				body: { role: "user", content },
			});
		} catch (error) {
			setError(
				error instanceof Error ? error.message : "An unknown error occurred.",
			);
		} finally {
			setIsLoading(false);
		}
	};

	const clearMessages = () => {
		setCurrentChatId(null);
		setError(null);
	};

	const handleNewChat = async () => {
		setIsLoading(true);
		setError(null);
		try {
			setCurrentChatId(null);
			setMessages([]);
		} catch {
			setError("Failed to create new chat. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleChatSelect = (chatId: string) => {
		setIsLoading(true);
		setError(null);
		try {
			setMessages([]);
			setCurrentChatId(chatId);
		} catch {
			setError("Failed to load chat. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	// keep URL in sync with selected model
	useEffect(() => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		if (selectedModel) {
			params.set("model", selectedModel);
		} else {
			params.delete("model");
		}
		const qs = params.toString();
		router.replace(qs ? `?${qs}` : "");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedModel]);

	const [text, setText] = useState("");

	const supportsImages = useMemo(() => {
		const model = availableModels.find((m) => m.id === selectedModel);
		return !!model?.vision;
	}, [availableModels, selectedModel]);

	return (
		<SidebarProvider>
			<div className="flex h-screen bg-background w-full">
				<ChatSidebar
					onNewChat={handleNewChat}
					onChatSelect={handleChatSelect}
					currentChatId={currentChatId || undefined}
					clearMessages={clearMessages}
					userApiKey={userApiKey}
					isLoading={isLoading}
				/>
				<div className="flex flex-1 flex-col w-full h-full">
					<div className="flex-shrink-0">
						<ChatHeader
							models={models}
							providers={providers}
							selectedModel={selectedModel}
							onManageApiKey={() => setShowApiKeyManager(true)}
							setSelectedModel={setSelectedModel}
						/>
					</div>
					<div className="flex-1 overflow-hidden">
						<ChatUI
							messages={messages}
							supportsImages={supportsImages}
							sendMessage={sendMessage}
							userApiKey={userApiKey}
							selectedModel={selectedModel}
							text={text}
							setText={setText}
							status={status}
							stop={stop}
							regenerate={regenerate}
							onUserMessage={handleUserMessage}
							isLoading={isLoading}
							error={error}
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
