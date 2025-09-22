"use client";

import { useChat, type UIMessage } from "@ai-sdk/react";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";
import { Message } from "@/components/ai-elements/message";
import { ApiKeyManager } from "@/components/playground/api-key-manager";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatSidebar } from "@/components/playground/chat-sidebar";
import { useUser } from "@/hooks/useUser";
import { useApiKey } from "@/hooks/useApiKey";
import {
	useAddMessage,
	useChats,
	useCreateChat,
	useDataChat,
} from "@/hooks/useChats";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ChatHeader } from "@/components/playground/chat-header";
import { ChatUI } from "./chat-ui";
import { DefaultChatTransport } from "ai";

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

export default function ChatPageClient({
	models,
	providers,
}: {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
}) {
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

	const { messages, setMessages, sendMessage, status, stop } = useChat({
		onError: (e) => {
			setError(e.message);
		},
		onFinish: async ({ message }) => {
			const chatId = chatIdRef.current;
			if (!chatId) return;
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
		if (currentChatData?.messages) {
			setMessages(
				currentChatData.messages.map((msg) => ({
					id: msg.id,
					role: msg.role,
					content: msg.content ?? "",
					parts: [{ type: "text", text: msg.content ?? "" }],
				})),
			);
		} else {
			setMessages([]);
		}
	}, [currentChatData, setMessages]);

	const [showApiKeyManager, setShowApiKeyManager] = useState(false);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isUserLoading && !user;

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
			console.error("Failed to create chat:", error);
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
		} catch (error) {
			console.error("Failed to create new chat:", error);
			setError("Failed to create new chat. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleChatSelect = (chatId: string) => {
		setIsLoading(true);
		setError(null);
		try {
			setCurrentChatId(chatId);
		} catch (error) {
			console.error("Failed to select chat:", error);
			setError("Failed to load chat. Please try again.");
		} finally {
			setIsLoading(false);
		}
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
						onUserMessage={handleUserMessage}
						isLoading={isLoading}
						error={error}
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
