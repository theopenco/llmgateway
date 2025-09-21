"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

import { Message } from "@/components/ai-elements/message";

import { ApiKeyManager } from "@/components/playground/api-key-manager";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatSidebar } from "@/components/playground/chat-sidebar";

import { useAppConfig } from "@/lib/config";
import { useUser } from "@/hooks/useUser";
import { useApiKey } from "@/hooks/useApiKey";
import { useApi } from "@/lib/fetch-client";
import { useQueryClient } from "@tanstack/react-query";
import {
	useAddMessage,
	useChats,
	useCreateChat,
	useDataChat,
} from "@/hooks/useChats";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ChatHeader } from "@/components/playground/chat-header";
import { ChatUI } from "./chat-ui";

type ComboboxModel = {
	id: string; // providerId/modelName (value sent to API)
	name?: string; // Friendly model name
	provider?: string; // Provider display name
	providerId?: string; // Provider id
	family?: string; // Model family for icon fallback
	context?: number;
	inputPrice?: number;
	outputPrice?: number;
	vision?: boolean;
	tools?: boolean;
};

function mapModels(
	models: readonly ModelDefinition[],
	providers: readonly ProviderDefinition[],
): ComboboxModel[] {
	const entries: ComboboxModel[] = [];
	for (const m of models) {
		for (const p of m.providers) {
			const providerInfo = providers.find((pr) => pr.id === p.providerId);
			entries.push({
				id: `${p.providerId}/${p.modelName}`,
				name: m.name ?? m.id,
				provider: providerInfo?.name ?? p.providerId,
				providerId: p.providerId,
				family: m.family,
				context: p.contextSize,
				inputPrice: p.inputPrice,
				outputPrice: p.outputPrice,
				vision: p.vision,
				tools: p.tools,
			});
		}
	}
	return entries;
}

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

export default function ChatPageClient({
	models,
	providers,
}: {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
}) {
	const config = useAppConfig();
	const { user, isLoading: isUserLoading } = useUser();
	const { userApiKey, isLoaded: isApiKeyLoaded } = useApiKey();
	const router = useRouter();
	const searchParams = useSearchParams();
	const api = useApi();
	const queryClient = useQueryClient();

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

	const [initialMessages, setInitialMessages] = useState<Message[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentChatId, setCurrentChatId] = useState<string | null>(null);

	// Chat API hooks
	const createChat = useCreateChat();
	const addMessage = useAddMessage();
	const { data: currentChatData } = useDataChat(currentChatId ?? "");
	useChats();

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
			setInitialMessages((prevMessages) => {
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
			setInitialMessages([]);
		}
	}, [currentChatData]);

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

	const clearMessages = () => {
		setInitialMessages([]);
		setCurrentChatId(null);
		setError(null);
	};

	const handleNewChat = async () => {
		setInitialMessages([]);
		setCurrentChatId(null);
		setError(null);
	};

	const handleChatSelect = (chatId: string) => {
		setCurrentChatId(chatId);
		setError(null);
		// Clear messages immediately to avoid showing stale data while loading
		setInitialMessages([]);
	};

	// keep URL in sync with selected model
	useEffect(() => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		if (selectedModel) params.set("model", selectedModel);
		else params.delete("model");
		const qs = params.toString();
		router.replace(qs ? `?${qs}` : "");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedModel]);

	const addLocalMessage = (message: Omit<Message, "id" | "timestamp">) => {
		const newMessage: Message = {
			...message,
			id: Date.now().toString(),
			timestamp: new Date(),
		};
		setInitialMessages((prev) => [...prev, newMessage]);
		return newMessage;
	};

	const { messages, sendMessage, status, stop } = useChat({
		id: currentChatId ?? "",
		// initialMessages: initialMessages,
		onError: (error) => {
			setError(error.message);
		},
		onFinish: () => {
			setIsLoading(false);
		},
	});
	const [text, setText] = useState("");

	const supportsImages = useMemo(() => {
		const model = availableModels.find((m) => m.id === selectedModel);
		return !!model?.vision;
	}, [availableModels, selectedModel]);

	// Theme handled by ThemeToggle from @ui via next-themes

	// const [showApiKeyManager, setShowApiKeyManager] = useState(false);

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
						models={models}
						providers={providers}
						selectedModel={selectedModel}
						onManageApiKey={() => setShowApiKeyManager(true)}
						setSelectedModel={setSelectedModel}
					/>
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
					/>
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
