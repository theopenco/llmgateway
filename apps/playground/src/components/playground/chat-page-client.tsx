"use client";

import { useChat } from "@ai-sdk/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { toast } from "sonner";

// Removed API key manager for playground; we rely on server-set cookie
import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatHeader } from "@/components/playground/chat-header";
import {
	ChatSidebar,
	type ChatSidebarHandle,
} from "@/components/playground/chat-sidebar";
import { ChatUI } from "@/components/playground/chat-ui";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { SidebarProvider } from "@/components/ui/sidebar";
// No local api key. We'll call backend to ensure key cookie exists after login.
import {
	useAddMessage,
	useCreateChat,
	useDataChat,
	useDeleteChat,
	useForkChat,
	useUpdateMessage,
} from "@/hooks/useChats";
import { useMcpServers } from "@/hooks/useMcpServers";
import { useSkills, type Skill } from "@/hooks/useSkills";
import { useUser } from "@/hooks/useUser";
import { getModelImageConfig } from "@/lib/image-gen";
import { parseImageFile } from "@/lib/image-utils";
import { mapModels } from "@/lib/mapmodels";
import { parsePlaygroundMessageMetadata } from "@/lib/message-metadata";
import {
	CHAT_MODEL_COOKIE,
	getModelPreferenceCookie,
	setModelPreferenceCookie,
} from "@/lib/model-preferences";
import { shouldDisableFallback } from "@/lib/no-fallback";
import { getErrorMessage } from "@/lib/utils";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
import type { ComboboxModel, Organization, Project } from "@/lib/types";
import type { UIMessage } from "ai";

/**
 * Minimal interface for tool parts from AI SDK v6 (tool-{toolName} pattern)
 */
interface ToolPart {
	type: string;
	[key: string]: unknown;
}

/**
 * Type guard to check if an object is a ToolPart (type starts with "tool-")
 */
function isToolPart(obj: unknown): obj is ToolPart {
	return (
		typeof obj === "object" &&
		obj !== null &&
		"type" in obj &&
		typeof (obj as ToolPart).type === "string" &&
		(obj as ToolPart).type.startsWith("tool-")
	);
}

function getFirstUserMessageText(
	messages: { role: string; parts?: { type: string; text?: string }[] }[],
): string | null {
	for (const message of messages) {
		if (message.role !== "user") {
			continue;
		}
		const text = (message.parts ?? [])
			.filter((p) => p.type === "text" && typeof p.text === "string")
			.map((p) => p.text as string)
			.join(" ")
			.trim();
		if (text) {
			return text;
		}
	}
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function getImagePartsForMessage(message: UIMessage): unknown[] {
	return (message.parts as unknown[]).filter((part) => {
		if (!isRecord(part)) {
			return false;
		}
		if (part.type === "image_url") {
			return true;
		}
		if (part.type !== "file") {
			return false;
		}
		const mediaType = readString(part.mediaType);
		return !!mediaType?.startsWith("image/");
	});
}

function getAudioPartsForMessage(message: UIMessage): unknown[] {
	return (message.parts as unknown[]).filter((part) => {
		if (!isRecord(part)) {
			return false;
		}
		if (part.type !== "file") {
			return false;
		}
		const mediaType = readString(part.mediaType);
		return !!mediaType?.startsWith("audio/");
	});
}

function getAudiosForStorage(
	message: UIMessage,
): Array<{ type: "audio"; url: string; mediaType: string; name?: string }> {
	const audios: Array<{
		type: "audio";
		url: string;
		mediaType: string;
		name?: string;
	}> = [];

	for (const part of message.parts as unknown[]) {
		if (!isRecord(part) || part.type !== "file") {
			continue;
		}
		const mediaType = readString(part.mediaType);
		const url = readString(part.url);
		if (!mediaType?.startsWith("audio/") || !url) {
			continue;
		}
		const name = readString(part.name);
		audios.push({ type: "audio", url, mediaType, ...(name ? { name } : {}) });
	}

	return audios;
}

function getImagesForStorage(
	message: UIMessage,
): Array<{ type: "image_url"; image_url: { url: string } }> {
	const images: Array<{ type: "image_url"; image_url: { url: string } }> = [];

	for (const part of message.parts as unknown[]) {
		if (!isRecord(part)) {
			continue;
		}

		if (part.type === "image_url") {
			const imageUrl = isRecord(part.image_url)
				? readString(part.image_url.url)
				: undefined;
			if (imageUrl) {
				images.push({
					type: "image_url",
					image_url: { url: imageUrl },
				});
			}
			continue;
		}

		if (part.type !== "file") {
			continue;
		}

		const mediaType = readString(part.mediaType);
		const url = readString(part.url);
		if (!mediaType?.startsWith("image/") || !url) {
			continue;
		}

		const { dataUrl } = parseImageFile({ url, mediaType });
		images.push({
			type: "image_url",
			image_url: { url: dataUrl },
		});
	}

	return images;
}

function buildEditedUserMessage(
	message: UIMessage,
	content: string,
): UIMessage {
	const parts: unknown[] = [];
	if (content.trim()) {
		parts.push({ type: "text", text: content });
	}
	parts.push(...getImagePartsForMessage(message));
	parts.push(...getAudioPartsForMessage(message));

	return {
		...message,
		role: "user",
		parts: parts as UIMessage["parts"],
	};
}

interface ChatPageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialPrompt?: string;
	enableWebSearch?: boolean;
	initialModelPreference?: string | null;
}

function parseModelSelectorValue(value: string): {
	providerId: string;
	modelId: string;
	region: string | undefined;
} {
	const [providerId, rawModelId] = value.includes("/")
		? (value.split("/") as [string, string])
		: ["", value];
	const colonIndex = rawModelId.lastIndexOf(":");

	return {
		providerId,
		modelId: colonIndex === -1 ? rawModelId : rawModelId.slice(0, colonIndex),
		region: colonIndex === -1 ? undefined : rawModelId.slice(colonIndex + 1),
	};
}

function getSelectedMapping(
	model: ApiModel,
	providerId: string,
	region: string | undefined,
): ApiModelProviderMapping | undefined {
	return (
		model.mappings.find(
			(mapping) =>
				mapping.providerId === providerId &&
				(mapping.region ?? undefined) === region,
		) ?? model.mappings.find((mapping) => mapping.providerId === providerId)
	);
}

export default function ChatPageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects,
	selectedProject,
	initialPrompt,
	enableWebSearch = false,
	initialModelPreference,
}: ChatPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const posthog = usePostHog();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const skillIdFromUrl = searchParams.get("skillId");
	const mapped = useMemo(
		() => mapModels(models, providers),
		[models, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	const getInitialModel = () => {
		const modelFromUrl = searchParams.get("model");
		if (modelFromUrl) {
			return modelFromUrl.split(",")[0] ?? "auto";
		}
		const stored =
			getModelPreferenceCookie(CHAT_MODEL_COOKIE) ?? initialModelPreference;
		if (stored) {
			return stored;
		}
		return "auto";
	};

	const [selectedModel, setSelectedModel] = useState(() => getInitialModel());
	const [reasoningEffort, setReasoningEffort] = useState<
		"" | "minimal" | "low" | "medium" | "high"
	>("");
	const [imageAspectRatio, setImageAspectRatio] = useState<
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
		| "21:9"
		| "1:4"
		| "4:1"
		| "1:8"
		| "8:1"
	>("auto");
	const [imageSize, setImageSize] = useState<string>("1K");
	const [alibabaImageSize, setAlibabaImageSize] = useState<string>(() => {
		const config = getModelImageConfig(getInitialModel());
		return config.isGptImage ? config.defaultSize : "1024x1024";
	});
	const [imageQuality, setImageQuality] = useState<string>(() => {
		const config = getModelImageConfig(getInitialModel());
		return config.defaultQuality ?? "auto";
	});
	const [imageCount, setImageCount] = useState<1 | 2 | 3 | 4>(1);
	const [webSearchEnabled, setWebSearchEnabled] = useState(enableWebSearch);
	const [activeSkills, setActiveSkills] = useState<Skill[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [finishReason, setFinishReason] = useState<string | null>(null);
	const [showTopUp, setShowTopUp] = useState(false);
	const [isTemporaryChat, setIsTemporaryChat] = useState(false);
	const [pendingVideoModel, setPendingVideoModel] = useState<string | null>(
		null,
	);

	// MCP servers management
	const {
		servers: mcpServers,
		addServer: addMcpServer,
		updateServer: updateMcpServer,
		removeServer: removeMcpServer,
		toggleServer: toggleMcpServer,
		getEnabledServers: getEnabledMcpServers,
	} = useMcpServers();

	// Skills
	const { data: skillsData } = useSkills();
	const skillInitializedRef = useRef(false);
	useEffect(() => {
		if (!skillIdFromUrl || !skillsData?.skills || skillInitializedRef.current) {
			return;
		}
		const found = (skillsData.skills as Skill[]).find(
			(s) => s.id === skillIdFromUrl,
		);
		if (found) {
			skillInitializedRef.current = true;
			setActiveSkills([found]);
		}
	}, [skillIdFromUrl, skillsData]);

	// Get chat ID from URL search params
	const chatIdFromUrl = searchParams.get("id");
	const [currentChatId, setCurrentChatId] = useState<string | null>(
		chatIdFromUrl,
	);
	const chatIdRef = useRef(currentChatId);
	// Captures the chat ID at stream-start so onFinish always saves to the
	// originating chat even if the user navigates to another chat mid-stream.
	const streamingChatIdRef = useRef<string | null>(null);
	const isNewChatRef = useRef(false);
	// Set to true only when code explicitly clears away from a chat (New Chat,
	// delete, 404 recovery). Lets the model-sync effect distinguish "we just
	// cleared a chat" from "we are navigating to a chat from blank state".
	const clearingChatRef = useRef(false);
	const errorOccurredRef = useRef(false);
	const isSendingRef = useRef(false);
	const panelIdCounterRef = useRef(1);
	// Flag to indicate we should clear messages on next URL change (set by handleChatSelect)
	const shouldClearMessagesRef = useRef(false);
	// Tracks which chat's messages are currently displayed in the useChat state,
	// so we know when a navigation requires reloading from the server.
	const loadedChatIdRef = useRef<string | null>(null);
	// Set by programmatic chat creation/forking before the URL update propagates.
	// Used by the URL sync effect to avoid correcting currentChatId back to the
	// stale URL value while router navigation is catching up.
	const pendingNewChatRef = useRef<string | null>(null);

	const { messages, setMessages, sendMessage, status, stop, regenerate } =
		useChat({
			onError: async (e) => {
				streamingChatIdRef.current = null;
				isSendingRef.current = false;
				errorOccurredRef.current = true;
				const msg = getErrorMessage(e);
				setError(msg);
				toast.error(msg);

				// If it was a new chat and AI failed to respond, delete the chat
				if (isNewChatRef.current && chatIdRef.current) {
					try {
						await deleteChat.mutateAsync({
							params: { path: { id: chatIdRef.current } },
						});
						// Reset state
						setCurrentChatId(null);
						clearingChatRef.current = true;
						chatIdRef.current = null;
						setMessages([]);
						isNewChatRef.current = false;
					} catch (cleanupError) {
						toast.error(
							"Failed to cleanup chat: " + getErrorMessage(cleanupError),
						);
					}
				}
			},
			onFinish: async ({ message, finishReason: reason }) => {
				isSendingRef.current = false;
				isNewChatRef.current = false;

				// Track finish reason for inline display
				if (reason && reason !== "stop" && reason !== "tool-calls") {
					setFinishReason(reason);
				} else {
					setFinishReason(null);
				}

				// If an error already occurred during streaming, skip saving the response
				if (errorOccurredRef.current) {
					errorOccurredRef.current = false;
					return;
				}
				if (isTemporaryChat) {
					return;
				}

				// Use the chat ID captured at stream-start. This ref is set before
				// sendMessage is called so it's always available here, even if the
				// user navigated to a different chat while the stream was running.
				const chatId = streamingChatIdRef.current;
				streamingChatIdRef.current = null;

				if (!chatId) {
					toast.error(
						"Failed to save AI response: No chat ID found (chat may not have finished saving before the stream ended).",
					);
					return;
				}
				// Extract assistant text, images, and reasoning from UIMessage parts
				const textContent = message.parts
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("");

				const reasoningContent = message.parts
					.filter((p) => p.type === "reasoning")
					.map((p) => p.text)
					.join("");

				const imageUrlParts = (message.parts as any[])
					.filter((p: any) => p.type === "image_url" && p.image_url?.url)
					.map((p: any) => ({
						type: "image_url",
						image_url: { url: p.image_url.url },
					}));

				// Handle file parts for images (supports multiple shapes from providers)
				const fileParts = (message.parts as any[])
					.filter((p) => {
						if (p.type !== "file") {
							return false;
						}
						const mediaType =
							p.mediaType ??
							p.mimeType ??
							p.mime_type ??
							p.file?.mediaType ??
							p.file?.mimeType ??
							p.file?.mime_type;
						return (
							typeof mediaType === "string" && mediaType.startsWith("image/")
						);
					})
					.map((p) => {
						const mediaType =
							p.mediaType ??
							p.mimeType ??
							p.mime_type ??
							p.file?.mediaType ??
							p.file?.mimeType ??
							p.file?.mime_type;
						const url =
							p.url ??
							p.data ??
							p.base64 ??
							p.file?.url ??
							p.file?.data ??
							p.file?.base64;
						const { dataUrl } = parseImageFile({
							url,
							mediaType,
						});
						return {
							type: "image_url" as const,
							image_url: { url: dataUrl },
						};
					});

				const images = [...imageUrlParts, ...fileParts];

				// Extract tool parts (AI SDK v6 uses tool-{toolName} as the part type)
				const toolParts = message.parts.filter(isToolPart);
				const metadata = parsePlaygroundMessageMetadata(message.metadata);

				const bodyToSave = {
					role: "assistant" as const,
					content: textContent || undefined,
					images: images.length > 0 ? JSON.stringify(images) : undefined,
					reasoning: reasoningContent || undefined,
					tools: toolParts.length > 0 ? JSON.stringify(toolParts) : undefined,
					...(metadata ? { metadata } : {}),
				};

				try {
					await addMessage.mutateAsync({
						params: { path: { id: chatId } },
						body: bodyToSave,
					});
				} catch (error: any) {
					// If chat not found, clear the stale chat ID
					if (
						error?.status === 404 &&
						error?.message?.includes("Chat not found")
					) {
						clearingChatRef.current = true;
						chatIdRef.current = null;
						setCurrentChatId(null);
						setMessages([]);
						toast.error("Chat was deleted. Please start a new conversation.");
					} else {
						toast.error(
							`Failed to save AI response: ${getErrorMessage(error)}`,
						);
					}
				}
				// Note: useAddMessage already invalidates /chats query on success
			},
		});

	// Sync currentChatId with URL param changes
	useEffect(() => {
		if (chatIdFromUrl === currentChatId) {
			// URL caught up with state — clear the pending flag.
			if (pendingNewChatRef.current === currentChatId) {
				pendingNewChatRef.current = null;
			}
			return;
		}

		// Guard programmatic chat creation/forking races: we just set currentChatId
		// and pushed/replaced the URL, but chatIdFromUrl hasn't propagated yet.
		// Wait for the URL to catch up instead of downgrading to the stale URL value.
		if (
			pendingNewChatRef.current !== null &&
			currentChatId === pendingNewChatRef.current &&
			chatIdFromUrl !== pendingNewChatRef.current
		) {
			return;
		}

		if (shouldClearMessagesRef.current) {
			setMessages([]);
			// Release ownership so the next chat reloads from the server.
			loadedChatIdRef.current = null;
			shouldClearMessagesRef.current = false;
		}
		setCurrentChatId(chatIdFromUrl);
	}, [chatIdFromUrl, currentChatId, setMessages]);

	useEffect(() => {
		chatIdRef.current = currentChatId;
	}, [currentChatId]);

	const supportsImages = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.vision);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.vision;
	}, [models, selectedModel]);

	const supportsAudio = useMemo(() => {
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.audio;
	}, [availableModels, selectedModel]);

	const supportsDocuments = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.document);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.document;
	}, [models, selectedModel]);

	const supportsImageGen = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { modelId } = parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		return !!def?.output?.includes("image");
	}, [models, selectedModel]);

	const supportsReasoning = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.reasoning);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.reasoning;
	}, [models, selectedModel]);

	const supportsWebSearch = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.webSearch);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.webSearch;
	}, [models, selectedModel]);

	const buildRequestOptions = useCallback(
		(hasImageAttachments: boolean, options?: any) => {
			// Only use image gen when the model supports it AND user didn't attach images for vision
			const useImageGen =
				supportsImageGen && !(supportsImages && hasImageAttachments);

			// Check if model uses WIDTHxHEIGHT format (Alibaba, ZAI, or OpenAI gpt-image)
			const isGptImage =
				selectedModel.toLowerCase().includes("gpt-image") ||
				selectedModel.toLowerCase().includes("openai/gpt-image");
			const usesPixelDimensions =
				isGptImage ||
				selectedModel.toLowerCase().includes("alibaba") ||
				selectedModel.toLowerCase().includes("qwen-image") ||
				selectedModel.toLowerCase().includes("zai") ||
				selectedModel.toLowerCase().includes("cogview");

			// Always forward the user's quality choice (including "auto") so it
			// surfaces in the activity log; the gateway treats "auto" as a no-op
			// upstream.
			const includeQuality = isGptImage && !!imageQuality;

			// Always send n explicitly to prevent providers from defaulting to >1
			const imageConfig = useImageGen
				? usesPixelDimensions
					? {
							...(isGptImage
								? alibabaImageSize !== "auto" && {
										image_size: alibabaImageSize,
									}
								: alibabaImageSize !== "1024x1024" && {
										image_size: alibabaImageSize,
									}),
							...(includeQuality && { image_quality: imageQuality }),
							n: imageCount,
						}
					: {
							...(imageAspectRatio !== "auto" && {
								aspect_ratio: imageAspectRatio,
							}),
							...(imageSize !== "1K" && { image_size: imageSize }),
							n: imageCount,
						}
				: undefined;

			const noFallback = shouldDisableFallback(selectedModel);

			// Get enabled MCP servers
			const enabledMcpServers = getEnabledMcpServers();

			return {
				...options,
				headers: {
					...(options?.headers ?? {}),
					...(noFallback ? { "x-no-fallback": "true" } : {}),
				},
				body: {
					...(options?.body ?? {}),
					model: selectedModel,
					...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
					...(imageConfig ? { image_config: imageConfig } : {}),
					...(useImageGen ? { is_image_gen: true } : {}),
					...(webSearchEnabled && supportsWebSearch
						? { web_search: true }
						: {}),
					...(enabledMcpServers.length > 0
						? { mcp_servers: enabledMcpServers }
						: {}),
					...(isTemporaryChat ? { temporary_chat: true } : {}),
					...(activeSkills.length > 0
						? {
								skill_instructions: activeSkills
									.filter((s) => s.enabled)
									.map((s) => s.instructions)
									.join("\n\n"),
							}
						: {}),
				},
			};
		},
		[
			reasoningEffort,
			supportsImageGen,
			supportsImages,
			imageAspectRatio,
			imageSize,
			alibabaImageSize,
			imageQuality,
			imageCount,
			selectedModel,
			webSearchEnabled,
			supportsWebSearch,
			getEnabledMcpServers,
			isTemporaryChat,
			activeSkills,
		],
	);

	const sendMessageWithHeaders = useCallback(
		(message: any, options?: any) => {
			const hasImageAttachments = message.parts?.some(
				(p: any) => p.type === "file" && p.mediaType?.startsWith("image/"),
			);
			return sendMessage(
				message,
				buildRequestOptions(!!hasImageAttachments, options),
			);
		},
		[sendMessage, buildRequestOptions],
	);

	const regenerateWithHeaders = useCallback(
		(options?: any) => {
			const lastUserMessage = [...messages]
				.reverse()
				.find((m) => m.role === "user");
			const hasImageAttachments = lastUserMessage?.parts?.some(
				(p: any) =>
					(p.type === "file" && p.mediaType?.startsWith("image/")) ||
					p.type === "image_url",
			);
			streamingChatIdRef.current = chatIdRef.current;
			return regenerate(buildRequestOptions(!!hasImageAttachments, options));
		},
		[regenerate, messages, buildRequestOptions],
	);

	// Additional comparison chat windows (primary + up to two comparison panels)
	const [comparisonEnabled, setComparisonEnabled] = useState(
		() => searchParams.get("compare") === "1",
	);
	const [extraPanelModels, setExtraPanelModels] = useState<string[]>(() => {
		const modelParam = searchParams.get("model");
		if (modelParam && searchParams.get("compare") === "1") {
			return modelParam.split(",").slice(1).filter(Boolean);
		}
		return [];
	});
	const [extraPanelIds, setExtraPanelIds] = useState<number[]>(() => {
		const modelParam = searchParams.get("model");
		if (modelParam && searchParams.get("compare") === "1") {
			const extras = modelParam.split(",").slice(1).filter(Boolean);
			return extras.map((_, i) => i + 1);
		}
		return [];
	});
	const [comparisonChatIds, setComparisonChatIds] = useState<string[]>([]);
	const [syncInput, setSyncInput] = useState(true);
	const [syncedText, setSyncedText] = useState(initialPrompt ?? "");
	const extraSubmitRefs = useRef<
		Record<number, (content: string) => Promise<void> | void>
	>({});
	const [comparisonResetToken, setComparisonResetToken] = useState(0);

	const sidebarRef = useRef<ChatSidebarHandle | null>(null);

	// Chat API hooks
	const createChat = useCreateChat();
	const addMessage = useAddMessage();
	const updateMessage = useUpdateMessage();
	const deleteChat = useDeleteChat();
	const deleteComparisonChat = useDeleteChat({ silent: true });
	const forkChat = useForkChat();
	const { data: currentChatData, isLoading: isChatLoading } = useDataChat(
		currentChatId ?? "",
	);

	useEffect(() => {
		// Use `status` from useChat (reactive) instead of the isSendingRef ref so
		// the effect re-runs when a stream finishes and can pick up a chat the
		// user navigated to mid-stream.
		if (status === "submitted" || status === "streaming" || isTemporaryChat) {
			return;
		}

		// No chat selected: drop ownership so the next chat we visit reloads cleanly.
		if (!currentChatId) {
			loadedChatIdRef.current = null;
			return;
		}

		if (!currentChatData?.messages) {
			return;
		}

		const fetchedChatId = currentChatData.chat?.id ?? null;

		// Wait until the fetched data is for the chat the user actually selected —
		// otherwise we'd briefly render the previous chat's messages while
		// useDataChat refetches against the new key.
		if (fetchedChatId !== currentChatId) {
			return;
		}

		// Already loaded this chat's messages into useChat state. Skip so that
		// post-send query invalidations don't clobber the just-streamed reply.
		if (loadedChatIdRef.current === fetchedChatId) {
			return;
		}

		loadedChatIdRef.current = fetchedChatId;

		if (currentChatData.chat?.model) {
			setSelectedModel(currentChatData.chat.model);
		}

		if (currentChatData.chat?.webSearch !== undefined) {
			setWebSearchEnabled(currentChatData.chat.webSearch);
		}

		if (currentChatData.chat?.comparisonEnabled !== undefined) {
			setComparisonEnabled(currentChatData.chat.comparisonEnabled);
		}

		const childIds = (currentChatData as any).comparisonChatIds as
			| string[]
			| undefined;
		if (childIds && childIds.length > 0) {
			setComparisonChatIds(childIds);
			setExtraPanelIds(childIds.map((_, i) => i + 1));
			setExtraPanelModels([]);
		} else {
			setComparisonChatIds([]);
			setExtraPanelIds([]);
			setExtraPanelModels([]);
		}

		const filteredMessages = currentChatData.messages.filter(
			(msg, index, arr) =>
				msg.role !== "assistant" || arr[index + 1]?.role !== "assistant",
		);
		setMessages(
			filteredMessages.map((msg) => {
				const parts: any[] = [];

				if (msg.content) {
					parts.push({ type: "text", text: msg.content });
				}

				if ((msg as any).reasoning) {
					parts.push({ type: "reasoning", text: (msg as any).reasoning });
				}

				if (msg.images) {
					try {
						const parsedImages = JSON.parse(msg.images);
						const imageParts = parsedImages.map((img: any) => {
							const dataUrl = img.image_url?.url ?? "";
							if (dataUrl.startsWith("data:")) {
								const [header, base64] = dataUrl.split(",");
								const mediaType =
									header.match(/data:([^;]+)/)?.[1] ?? "image/png";
								return {
									type: "file",
									mediaType,
									url: base64,
								};
							}
							return {
								type: "file",
								mediaType: "image/png",
								url: dataUrl,
							};
						});
						parts.push(...imageParts);
					} catch (error) {
						toast.error("Failed to parse images: " + getErrorMessage(error));
					}
				}

				if (msg.audios) {
					try {
						const parsedAudios = JSON.parse(msg.audios);
						if (Array.isArray(parsedAudios)) {
							for (const a of parsedAudios) {
								if (!a?.url) {
									continue;
								}
								parts.push({
									type: "file",
									mediaType: a.mediaType ?? "audio/mpeg",
									url: a.url,
									...(a.name ? { name: a.name } : {}),
								});
							}
						}
					} catch (error) {
						toast.error("Failed to parse audios: " + getErrorMessage(error));
					}
				}

				if ((msg as any).documents) {
					try {
						const parsedDocuments = JSON.parse((msg as any).documents);
						if (Array.isArray(parsedDocuments)) {
							for (const d of parsedDocuments) {
								if (!d?.url) {
									continue;
								}
								parts.push({
									type: "file",
									mediaType: d.mediaType ?? "application/octet-stream",
									url: d.url,
									...(d.name ? { name: d.name } : {}),
								});
							}
						}
					} catch (error) {
						toast.error("Failed to parse documents: " + getErrorMessage(error));
					}
				}

				if ((msg as any).tools) {
					try {
						const parsedTools = JSON.parse((msg as any).tools);
						if (Array.isArray(parsedTools)) {
							parts.push(...parsedTools.map((t: any) => ({ ...t })));
						}
					} catch (error) {
						toast.error("Failed to parse tools: " + getErrorMessage(error));
					}
				}

				return {
					id: msg.id,
					role: msg.role,
					content: msg.content ?? "",
					metadata: parsePlaygroundMessageMetadata(msg.metadata),
					createdAt: new Date(msg.createdAt),
					parts,
				};
			}),
		);
	}, [
		currentChatId,
		currentChatData,
		status,
		setMessages,
		setSelectedModel,
		setWebSearchEnabled,
		isTemporaryChat,
	]);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	// Track which project has had its key ensured to prevent duplicate calls
	const ensuredProjectRef = useRef<string | null>(null);

	// After login, ensure a playground key cookie exists via backend
	useEffect(() => {
		// Reset ref when user logs out or project is unset
		if (!isAuthenticated || !selectedProject) {
			ensuredProjectRef.current = null;
			return;
		}

		const ensureKey = async () => {
			const projectId = selectedProject.id;
			// Skip if we've already ensured the key for this project
			if (ensuredProjectRef.current === projectId) {
				return;
			}
			try {
				const response = await fetch("/api/ensure-playground-key", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId }),
				});
				if (response.ok && selectedProject.id === projectId) {
					ensuredProjectRef.current = projectId;
				}
			} catch {
				// ignore for now
			}
		};
		void ensureKey();
	}, [isAuthenticated, selectedOrganization, selectedProject]);

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
					webSearch: webSearchEnabled,
					comparisonEnabled,
				},
			});
			const newChatId = chatData.chat.id;

			setCurrentChatId(newChatId);
			chatIdRef.current = newChatId; // Manually update the ref
			// Claim ownership: this chat's messages are being populated by the
			// in-flight stream, so the post-send refetch must not reload from server.
			loadedChatIdRef.current = newChatId;
			// Tell the URL sync effect to ignore the stale chatIdFromUrl=null
			// until router.replace propagates.
			pendingNewChatRef.current = newChatId;

			// Update URL with new chat ID (without triggering navigation)
			const params = new URLSearchParams(searchParams.toString());
			params.set("id", newChatId);
			router.replace(`${pathname}?${params.toString()}`);

			return newChatId;
		} catch (error) {
			setError("Failed to create a new chat. Please try again.");
			throw error;
		}
	};

	const handleUserMessage = async (
		content: string,
		images?: Array<{
			type: "image_url";
			image_url: { url: string };
		}>,
		audio?: Array<{
			type: "audio";
			url: string;
			mediaType: string;
			name?: string;
		}>,
		documents?: Array<{
			type: "file";
			url: string;
			mediaType: string;
			name?: string;
		}>,
	) => {
		if (selectedOrganization && Number(selectedOrganization.credits) <= 0) {
			setShowTopUp(true);
			return undefined;
		}

		let savedUserMessage: { id: string } | undefined;
		setError(null);
		setFinishReason(null);
		setIsLoading(true);
		posthog.capture("playground_chat_sent", {
			model: selectedModel,
			has_images: !!images?.length,
			has_audio: !!audio?.length,
			has_documents: !!documents?.length,
			web_search: webSearchEnabled,
		});
		errorOccurredRef.current = false;
		isSendingRef.current = true;
		if (isTemporaryChat) {
			isSendingRef.current = false;
			isNewChatRef.current = false;
			setIsLoading(false);
			if (syncInput) {
				const submitFns = Object.values(extraSubmitRefs.current);
				const results = await Promise.allSettled(
					submitFns.map((submit) => submit(content)),
				);
				for (const result of results) {
					if (result.status === "rejected") {
						posthog.capture("playground_mirror_prompt_failure", {
							reason: String(result.reason),
						});
					}
				}
			}
			return undefined;
		}

		const isNewChat = !chatIdRef.current;
		if (isNewChat) {
			isNewChatRef.current = true;
		}

		try {
			const chatId = await ensureCurrentChat(content);
			streamingChatIdRef.current = chatId;

			const savedMessage = await addMessage.mutateAsync({
				params: { path: { id: chatId } },
				body: {
					role: "user",
					...(content.trim() ? { content } : {}),
					...(images?.length ? { images: JSON.stringify(images) } : {}),
					...(audio?.length ? { audios: JSON.stringify(audio) } : {}),
					...(documents?.length
						? { documents: JSON.stringify(documents) }
						: {}),
				},
			});
			savedUserMessage = savedMessage.message;
		} catch (error: any) {
			// If chat not found, it means the chat was deleted or is stale
			if (error?.status === 404 && error?.message?.includes("Chat not found")) {
				clearingChatRef.current = true;
				chatIdRef.current = null;
				setCurrentChatId(null);
				setMessages([]);

				// Try again with a new chat
				try {
					const newChatId = await ensureCurrentChat(content);
					const savedMessage = await addMessage.mutateAsync({
						params: { path: { id: newChatId } },
						body: {
							role: "user",
							...(content.trim() ? { content } : {}),
							...(images?.length ? { images: JSON.stringify(images) } : {}),
							...(audio?.length ? { audios: JSON.stringify(audio) } : {}),
							...(documents?.length
								? { documents: JSON.stringify(documents) }
								: {}),
						},
					});
					setIsLoading(false);
					savedUserMessage = savedMessage.message;
				} catch (retryError) {
					const retryErrorMessage = getErrorMessage(retryError);
					setError(retryErrorMessage);
					toast.error(retryErrorMessage);
					setIsLoading(false);
					return undefined;
				}
			}

			// If free limit or message limit is hit, keep the existing UI state and show a
			// helpful toast instead of treating it like a hard failure/crash.
			if (
				error?.status === 400 &&
				(error?.message?.includes("MESSAGE_LIMIT_REACHED") ||
					error?.message?.includes("FREE_LIMIT_REACHED"))
			) {
				toast.error(error.message);
				return undefined;
			}

			const errorMessage = getErrorMessage(error);
			setError(errorMessage);
			toast.error(errorMessage);

			// If it was a new chat and we failed to add the first message, delete the chat
			if (isNewChat && chatIdRef.current) {
				try {
					await deleteChat.mutateAsync({
						params: { path: { id: chatIdRef.current } },
					});
					setCurrentChatId(null);
					clearingChatRef.current = true;
					chatIdRef.current = null;
					setMessages([]);
					isNewChatRef.current = false;
				} catch (cleanupError) {
					toast.error(
						"Failed to cleanup chat: " + getErrorMessage(cleanupError),
					);
				}
			}
		} finally {
			setIsLoading(false);
		}

		// When sync is enabled and comparison windows are open, mirror the
		// submitted prompt into each extra window as a separate user message.
		// Fire without awaiting so the primary panel can start streaming in
		// parallel rather than waiting for all extra panels to finish first.
		if (syncInput) {
			const submitFns = Object.values(extraSubmitRefs.current);
			void Promise.allSettled(submitFns.map((submit) => submit(content))).then(
				(results) => {
					for (const result of results) {
						if (result.status === "rejected") {
							// Don't surface comparison errors as hard failures;
							// capture as telemetry instead of logging to console.
							posthog.capture("playground_mirror_prompt_failure", {
								reason: String(result.reason),
							});
						}
					}
				},
			);
		}
		return savedUserMessage;
	};

	const handleSyncedSubmitFromExtraPanel = async (content: string) => {
		const savedMessage = await handleUserMessage(content);
		if (!savedMessage) {
			return;
		}
		const parts: any[] = [{ type: "text", text: content }];
		void sendMessageWithHeaders(
			{ id: savedMessage.id, role: "user", parts },
			{ body: { model: selectedModel } },
		);
	};

	const handleEditUserMessage = async (message: UIMessage, content: string) => {
		const chatId = chatIdRef.current;
		if (!chatId) {
			toast.error("No chat selected.");
			return;
		}

		if (selectedOrganization && Number(selectedOrganization.credits) <= 0) {
			setShowTopUp(true);
			return;
		}

		const editedMessage = buildEditedUserMessage(message, content);
		if (editedMessage.parts.length === 0) {
			return;
		}

		const images = getImagesForStorage(message);
		const audios = getAudiosForStorage(message);
		setError(null);
		setFinishReason(null);
		errorOccurredRef.current = false;
		isSendingRef.current = true;
		loadedChatIdRef.current = chatId;
		streamingChatIdRef.current = chatId;

		try {
			await updateMessage.mutateAsync({
				params: { path: { id: chatId, messageId: message.id } },
				body: {
					...(content.trim() ? { content } : {}),
					...(images.length ? { images: JSON.stringify(images) } : {}),
					...(audios.length ? { audios: JSON.stringify(audios) } : {}),
				},
			});

			const messageIndex = messages.findIndex((m) => m.id === message.id);
			const previousMessages =
				messageIndex === -1 ? messages : messages.slice(0, messageIndex);
			setMessages(previousMessages);
			await new Promise<void>((resolve) => {
				setTimeout(resolve, 0);
			});

			await sendMessageWithHeaders(editedMessage, {
				body: {
					model: selectedModel,
				},
			});
		} catch (error) {
			isSendingRef.current = false;
			const errorMessage = getErrorMessage(error);
			setError(errorMessage);
			toast.error(errorMessage);
		}
	};

	const clearMessages = () => {
		void stop();
		setError(null);
		setFinishReason(null);
		shouldClearMessagesRef.current = true;
		setCurrentChatId(null);
		clearingChatRef.current = true;
		chatIdRef.current = null;
		setMessages([]);
		// Remove id param from URL
		const params = new URLSearchParams(searchParams.toString());
		params.delete("id");
		params.delete("view");
		params.delete("shareOrgId");
		params.delete("shareId");
		const targetPathname = pathname;
		const newUrl = params.toString()
			? `${targetPathname}?${params.toString()}`
			: targetPathname;
		router.push(newUrl);
	};

	const hasTemporaryMessages = isTemporaryChat && messages.length > 0;

	const handleToggleTemporaryChat = () => {
		if (isTemporaryChat) {
			clearMessages();
			setIsTemporaryChat(false);
			return;
		}
		setComparisonEnabled(false);
		setExtraPanelIds([]);
		setExtraPanelModels([]);
		setComparisonResetToken((token) => token + 1);
		extraSubmitRefs.current = {};
		clearMessages();
		setIsTemporaryChat(true);
	};

	const handleNewChat = async () => {
		void stop();
		setIsLoading(true);
		setError(null);
		setFinishReason(null);
		try {
			shouldClearMessagesRef.current = true;
			clearingChatRef.current = true;
			chatIdRef.current = null;
			setMessages([]);
			// Remove id and comparison params from URL
			const params = new URLSearchParams(searchParams.toString());
			params.delete("id");
			params.delete("view");
			params.delete("shareOrgId");
			params.delete("shareId");
			params.delete("compare");
			// Reset model param to primary model only
			if (selectedModel) {
				params.set("model", selectedModel);
			}
			const targetPathname = pathname;
			const newUrl = params.toString()
				? `${targetPathname}?${params.toString()}`
				: targetPathname;
			router.push(newUrl);
			// Clear comparison windows as well
			setComparisonEnabled(false);
			setExtraPanelIds([]);
			setExtraPanelModels([]);
			setComparisonResetToken((token) => token + 1);
			extraSubmitRefs.current = {};
			setComparisonChatIds([]);
		} catch {
			setError("Failed to create new chat. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleChatSelect = (chatId: string) => {
		void stop();
		setError(null);
		setFinishReason(null);
		shouldClearMessagesRef.current = true; // Request message clear on URL change
		// Update URL with chat ID - this will trigger the useEffect to update state
		const params = new URLSearchParams(searchParams.toString());
		params.set("id", chatId);
		params.delete("view");
		params.delete("shareOrgId");
		params.delete("shareId");
		const targetPathname = pathname;
		router.push(
			params.toString()
				? `${targetPathname}?${params.toString()}`
				: targetPathname,
		);
	};

	const handleForkChat = useCallback(async () => {
		if (
			forkChat.isPending ||
			isTemporaryChat ||
			status === "submitted" ||
			status === "streaming"
		) {
			return;
		}

		const chatId = chatIdRef.current ?? currentChatId;
		if (!chatId) {
			return;
		}

		try {
			const data = await forkChat.mutateAsync({
				params: { path: { id: chatId } },
			});
			const newChatId = data.chat.id;

			setError(null);
			setFinishReason(null);
			shouldClearMessagesRef.current = false;
			setMessages([]);
			loadedChatIdRef.current = null;
			pendingNewChatRef.current = newChatId;
			setCurrentChatId(newChatId);
			chatIdRef.current = newChatId;

			const params = new URLSearchParams(searchParams.toString());
			params.set("id", newChatId);
			params.delete("view");
			params.delete("shareOrgId");
			params.delete("shareId");
			const targetPathname = pathname;
			router.push(
				params.toString()
					? `${targetPathname}?${params.toString()}`
					: targetPathname,
			);
			sidebarRef.current?.scrollToTop();
			toast.success("Chat forked");
		} catch {}
	}, [
		currentChatId,
		forkChat,
		isTemporaryChat,
		pathname,
		router,
		searchParams,
		setMessages,
		status,
	]);

	const handleSelectModel = useCallback(
		(model: string) => {
			const { modelId } = parseModelSelectorValue(model);
			const def = models.find((m) => m.id === modelId);
			if (def?.output?.includes("video")) {
				setPendingVideoModel(modelId);
				return;
			}
			setSelectedModel(model);
			if (model) {
				setModelPreferenceCookie(CHAT_MODEL_COOKIE, model);
			}
			const currentParams = new URLSearchParams(window.location.search);
			const allModels =
				comparisonEnabled && extraPanelModels.length > 0
					? [model, ...extraPanelModels]
					: [model];
			if (model) {
				currentParams.set("model", allModels.join(","));
			} else {
				currentParams.delete("model");
			}
			const qs = currentParams.toString();
			router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
		},
		[pathname, router, comparisonEnabled, extraPanelModels, models],
	);

	const handleExtraPanelModelChange = useCallback(
		(index: number, model: string) => {
			setExtraPanelModels((prev) => {
				const next = [...prev];
				next[index] = model;
				return next;
			});
		},
		[],
	);

	// Keep URL model param in sync with all comparison models
	useEffect(() => {
		const currentParams = new URLSearchParams(window.location.search);
		// clearingChatRef is set alongside chatIdRef.current = null only when code
		// explicitly clears away from a chat. Guard here so we don't strip a newly
		// selected chat's id when navigating from blank state (chatIdRef also null).
		if (!chatIdRef.current && clearingChatRef.current) {
			currentParams.delete("id");
			clearingChatRef.current = false;
		}
		if (comparisonEnabled && extraPanelIds.length > 0) {
			const allModels = [selectedModel, ...extraPanelModels];
			currentParams.set("model", allModels.join(","));
			currentParams.set("compare", "1");
		} else {
			if (selectedModel) {
				currentParams.set("model", selectedModel);
			} else {
				currentParams.delete("model");
			}
			currentParams.delete("compare");
		}
		const qs = currentParams.toString();
		const nextUrl = `${pathname}${qs ? `?${qs}` : ""}`;
		const currentUrl = `${window.location.pathname}${window.location.search}`;
		if (nextUrl !== currentUrl) {
			router.replace(nextUrl, { scroll: false });
		}
	}, [
		comparisonEnabled,
		extraPanelIds.length,
		selectedModel,
		extraPanelModels,
		pathname,
		router,
	]);

	const [text, setText] = useState(initialPrompt ?? "");
	const primaryText = syncInput ? syncedText : text;
	const setPrimaryText = (value: string) => {
		if (syncInput) {
			setSyncedText(value);
		}
		setText(value);
	};

	// Reset reasoning effort when switching to a non-reasoning model
	useEffect(() => {
		if (!supportsReasoning && reasoningEffort) {
			setReasoningEffort("");
		}
	}, [supportsReasoning, reasoningEffort]);

	// Reset image size/quality only when the selected model changes and the
	// current value is not valid for the new model. Including alibabaImageSize
	// or imageQuality in the deps would clobber a user's explicit selection.
	useEffect(() => {
		const config = getModelImageConfig(selectedModel);
		if (config.usesPixelDimensions) {
			if (!config.availableSizes.includes(alibabaImageSize as never)) {
				setAlibabaImageSize(config.defaultSize);
			}
		} else if (!config.availableSizes.includes(imageSize as never)) {
			setImageSize(config.defaultSize);
		}
		if (
			config.supportsQuality &&
			!(config.availableQualities as readonly string[]).includes(imageQuality)
		) {
			setImageQuality(config.defaultQuality ?? "auto");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedModel]);

	const handleSelectOrganization = (org: Organization | null) => {
		if (org?.id) {
			router.push(`/org/${org.id}`);
			return;
		}
		router.push("/");
	};

	const handleOrganizationCreated = (org: Organization) => {
		router.push(`/org/${org.id}`);
	};

	const handleSelectProject = (project: Project | null) => {
		if (!project) {
			return;
		}
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		params.set("orgId", project.organizationId);
		params.set("projectId", project.id);
		if (!params.get("model")) {
			params.set("model", selectedModel);
		}
		router.push(params.toString() ? `/?${params.toString()}` : "/");
	};

	const handleProjectCreated = (project: Project) => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		params.set("orgId", project.organizationId);
		params.set("projectId", project.id);
		if (!params.get("model")) {
			params.set("model", selectedModel);
		}
		router.push(params.toString() ? `/?${params.toString()}` : "/");
	};

	return (
		<SidebarProvider>
			<h1 className="sr-only">
				LLM Gateway Playground - Chat with 210+ AI Models
			</h1>
			<div className="flex h-svh bg-background w-full overflow-hidden">
				{isTemporaryChat ? null : (
					<ChatSidebar
						ref={sidebarRef}
						onNewChat={handleNewChat}
						onChatSelect={handleChatSelect}
						currentChatId={currentChatId ?? undefined}
						isLoading={isLoading}
						organizations={organizations}
						selectedOrganization={selectedOrganization}
						onSelectOrganization={handleSelectOrganization}
						onOrganizationCreated={handleOrganizationCreated}
						projects={projects}
						selectedProject={selectedProject}
						onSelectProject={handleSelectProject}
						onProjectCreated={handleProjectCreated}
					/>
				)}
				<main className="flex flex-1 flex-col w-full min-h-0 overflow-hidden">
					<header className="shrink-0">
						<ChatHeader
							models={models}
							providers={providers}
							selectedModel={selectedModel}
							setSelectedModel={handleSelectModel}
							comparisonEnabled={comparisonEnabled}
							hideCompare={messages.length > 0}
							onComparisonEnabledChange={(enabled) => {
								setComparisonEnabled(enabled);
								if (!enabled) {
									setExtraPanelIds([]);
									setExtraPanelModels([]);
									setComparisonResetToken((token) => token + 1);
									extraSubmitRefs.current = {};
								}
							}}
							showGlobalModelSelector={
								!(comparisonEnabled && extraPanelIds.length > 0)
							}
							mcpServers={mcpServers}
							onAddMcpServer={addMcpServer}
							onUpdateMcpServer={updateMcpServer}
							onRemoveMcpServer={removeMcpServer}
							onToggleMcpServer={toggleMcpServer}
							isTemporaryChat={isTemporaryChat}
							onToggleTemporaryChat={handleToggleTemporaryChat}
							showTemporaryChatSwitcher={!currentChatId}
							isTemporaryChatToggleDisabled={
								isLoading || status === "submitted" || status === "streaming"
							}
							hasTemporaryMessages={hasTemporaryMessages}
							currentChatId={currentChatId}
							isShareChatDisabled={
								isChatLoading ||
								status === "submitted" ||
								status === "streaming"
							}
							shareId={currentChatData?.chat?.shareId ?? null}
							orgShares={currentChatData?.chat?.orgShares ?? []}
							organizations={organizations}
							chatTitle={currentChatData?.chat?.title ?? null}
							previewPrompt={getFirstUserMessageText(messages)}
						/>
					</header>
					{comparisonEnabled && !isTemporaryChat ? (
						<div className="hidden md:flex shrink-0 border-b bg-muted/40 px-4 py-2 items-center justify-between gap-3">
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span className="font-medium">Chat windows</span>
								<span>
									{1 + extraPanelIds.length}
									{" / "}3
								</span>
								<Button
									size="sm"
									variant="outline"
									disabled={extraPanelIds.length >= 2}
									onClick={() =>
										setExtraPanelIds((prev) => {
											if (prev.length >= 2) {
												return prev;
											}
											const nextId = panelIdCounterRef.current + 1;
											panelIdCounterRef.current = nextId;
											return [...prev, nextId];
										})
									}
								>
									Add model for comparison
								</Button>
								{extraPanelIds.length > 0 ? (
									<Button
										size="sm"
										variant="ghost"
										onClick={() => {
											const removedChatId =
												comparisonChatIds[comparisonChatIds.length - 1];
											setExtraPanelIds((prev) => {
												if (prev.length === 0) {
													return prev;
												}
												const removedId = prev[prev.length - 1];
												const next = prev.slice(0, -1);
												const { [removedId]: _removed, ...rest } =
													extraSubmitRefs.current;
												extraSubmitRefs.current = rest;
												return next;
											});
											setComparisonChatIds((prev) => prev.slice(0, -1));
											setExtraPanelModels((prev) => prev.slice(0, -1));
											if (removedChatId) {
												deleteComparisonChat.mutate({
													params: { path: { id: removedChatId } },
												});
											}
										}}
									>
										Remove window
									</Button>
								) : null}
							</div>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<span className="font-medium">Sync prompt input</span>
								<Button
									size="sm"
									variant={syncInput ? "default" : "outline"}
									onClick={() => setSyncInput((prev) => !prev)}
								>
									{syncInput ? "On" : "Off"}
								</Button>
							</div>
						</div>
					) : null}
					<section className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
						<div
							className={`grid h-full ${
								!comparisonEnabled || extraPanelIds.length === 0
									? "grid-cols-1 w-full"
									: "gap-4 p-4 " +
										(extraPanelIds.length === 1
											? "grid-cols-1 md:grid-cols-2"
											: "grid-cols-1 md:grid-cols-3")
							}`}
						>
							{comparisonEnabled && extraPanelIds.length > 0 ? (
								<div className="flex flex-col h-full min-h-0 rounded-lg border bg-background">
									<div className="shrink-0 border-b bg-muted/40 px-3 py-2 flex items-center justify-between gap-2">
										<span className="text-xs font-medium text-muted-foreground">
											Model 1
										</span>
										<div className="w-full max-w-xs">
											<ModelSelector
												models={models}
												providers={providers}
												value={selectedModel}
												onValueChange={handleSelectModel}
												placeholder="Select a model..."
											/>
										</div>
									</div>
									<div className="flex-1 min-h-0">
										<ChatUI
											messages={messages}
											supportsImages={supportsImages}
											supportsAudio={supportsAudio}
											supportsDocuments={supportsDocuments}
											supportsImageGen={supportsImageGen}
											sendMessage={sendMessageWithHeaders}
											selectedModel={selectedModel}
											text={primaryText}
											setText={setPrimaryText}
											status={status}
											stop={stop}
											regenerate={regenerateWithHeaders}
											reasoningEffort={reasoningEffort}
											setReasoningEffort={setReasoningEffort}
											supportsReasoning={supportsReasoning}
											imageAspectRatio={imageAspectRatio}
											setImageAspectRatio={setImageAspectRatio}
											imageSize={imageSize}
											setImageSize={setImageSize}
											alibabaImageSize={alibabaImageSize}
											setAlibabaImageSize={setAlibabaImageSize}
											imageQuality={imageQuality}
											setImageQuality={setImageQuality}
											imageCount={imageCount}
											setImageCount={setImageCount}
											onUserMessage={handleUserMessage}
											isLoading={isLoading || isChatLoading}
											error={error}
											finishReason={finishReason}
											isTemporaryChat={isTemporaryChat}
											forkChat={!isTemporaryChat ? handleForkChat : undefined}
											isForkingChat={forkChat.isPending}
											setWebSearchEnabled={setWebSearchEnabled}
											supportsWebSearch={supportsWebSearch}
											webSearchEnabled={webSearchEnabled}
											activeSkills={activeSkills}
											onSelectSkill={(skill) =>
												setActiveSkills((prev) =>
													prev.some((s) => s.id === skill.id)
														? prev
														: [...prev, skill],
												)
											}
											onRemoveSkill={(id) =>
												setActiveSkills((prev) =>
													prev.filter((s) => s.id !== id),
												)
											}
										/>
									</div>
								</div>
							) : (
								<div className="flex flex-col min-h-0 w-full">
									<ChatUI
										messages={messages}
										supportsImages={supportsImages}
										supportsAudio={supportsAudio}
										supportsDocuments={supportsDocuments}
										supportsImageGen={supportsImageGen}
										sendMessage={sendMessageWithHeaders}
										selectedModel={selectedModel}
										text={primaryText}
										setText={setPrimaryText}
										status={status}
										stop={stop}
										regenerate={regenerateWithHeaders}
										reasoningEffort={reasoningEffort}
										setReasoningEffort={setReasoningEffort}
										supportsReasoning={supportsReasoning}
										imageAspectRatio={imageAspectRatio}
										setImageAspectRatio={setImageAspectRatio}
										imageSize={imageSize}
										setImageSize={setImageSize}
										alibabaImageSize={alibabaImageSize}
										setAlibabaImageSize={setAlibabaImageSize}
										imageQuality={imageQuality}
										setImageQuality={setImageQuality}
										imageCount={imageCount}
										setImageCount={setImageCount}
										supportsWebSearch={supportsWebSearch}
										webSearchEnabled={webSearchEnabled}
										setWebSearchEnabled={setWebSearchEnabled}
										onUserMessage={handleUserMessage}
										onEditUserMessage={handleEditUserMessage}
										isLoading={isLoading || isChatLoading}
										error={error}
										finishReason={finishReason}
										floatingInput
										isTemporaryChat={isTemporaryChat}
										forkChat={!isTemporaryChat ? handleForkChat : undefined}
										isForkingChat={forkChat.isPending}
										activeSkills={activeSkills}
										onSelectSkill={(skill) =>
											setActiveSkills((prev) =>
												prev.some((s) => s.id === skill.id)
													? prev
													: [...prev, skill],
											)
										}
										onRemoveSkill={(id) =>
											setActiveSkills((prev) => prev.filter((s) => s.id !== id))
										}
									/>
								</div>
							)}
							{comparisonEnabled
								? extraPanelIds.map((panelId, index) => (
										<div
											key={comparisonChatIds[index] ?? panelId}
											className="hidden md:flex flex-col h-full min-h-0"
										>
											<ExtraChatPanel
												panelIndex={index + 2}
												models={models}
												providers={providers}
												availableModels={availableModels}
												initialModel={extraPanelModels[index] ?? selectedModel}
												syncInput={syncInput}
												syncedText={syncedText}
												setSyncedText={setSyncedText}
												onRegisterExternalSubmit={(fn) => {
													extraSubmitRefs.current[panelId] = fn;
												}}
												onSyncedSubmitFromPanel={
													handleSyncedSubmitFromExtraPanel
												}
												syncedActiveSkills={
													syncInput ? activeSkills : undefined
												}
												setSyncedActiveSkills={
													syncInput ? setActiveSkills : undefined
												}
												onModelChange={(model) =>
													handleExtraPanelModelChange(index, model)
												}
												onVideoModelSelected={setPendingVideoModel}
												resetToken={comparisonResetToken}
												primaryChatId={currentChatId}
												primaryChatIdRef={chatIdRef}
												initialChatId={comparisonChatIds[index] ?? null}
												isParentLoading={isChatLoading}
											/>
										</div>
									))
								: null}
						</div>
					</section>
				</main>
			</div>
			<TopUpCreditsDialog open={showTopUp} onOpenChange={setShowTopUp} />
			<AuthDialog open={showAuthDialog} returnUrl={returnUrl} />
			<Dialog
				open={pendingVideoModel !== null}
				onOpenChange={(open) => {
					if (!open) {
						setPendingVideoModel(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Switch to Video Studio?</DialogTitle>
						<DialogDescription>
							{pendingVideoModel
								? (models.find((m) => m.id === pendingVideoModel)?.name ??
									pendingVideoModel)
								: ""}{" "}
							is a video generation model. Would you like to open it in Video
							Studio?
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setPendingVideoModel(null)}
						>
							Cancel
						</Button>
						<Button
							onClick={() => {
								if (pendingVideoModel) {
									router.push(`/video?model=${pendingVideoModel}`);
								}
								setPendingVideoModel(null);
							}}
						>
							Open Video Studio
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</SidebarProvider>
	);
}
interface ExtraChatPanelProps {
	panelIndex: number;
	models: ApiModel[];
	providers: ApiProvider[];
	availableModels: ComboboxModel[];
	initialModel: string;
	syncInput: boolean;
	syncedText: string;
	setSyncedText: (value: string) => void;
	onRegisterExternalSubmit: (
		submit: (content: string) => Promise<void> | void,
	) => void;
	onModelChange?: (model: string) => void;
	onVideoModelSelected?: (modelId: string) => void;
	resetToken: number;
	primaryChatId: string | null;
	primaryChatIdRef: React.RefObject<string | null>;
	initialChatId?: string | null;
	isParentLoading?: boolean;
	onSyncedSubmitFromPanel?: (content: string) => Promise<void>;
	syncedActiveSkills?: Skill[];
	setSyncedActiveSkills?: (skills: Skill[]) => void;
}

function ExtraChatPanel({
	panelIndex,
	models,
	providers,
	availableModels,
	initialModel,
	syncInput,
	syncedText,
	setSyncedText,
	onRegisterExternalSubmit,
	onModelChange,
	onVideoModelSelected,
	resetToken,
	primaryChatId,
	primaryChatIdRef,
	initialChatId = null,
	isParentLoading = false,
	onSyncedSubmitFromPanel,
	syncedActiveSkills,
	setSyncedActiveSkills,
}: ExtraChatPanelProps) {
	const [selectedModel, setSelectedModel] = useState(initialModel);
	const handleModelChange = useCallback(
		(model: string) => {
			const modelId = model.includes("/")
				? (model.split("/")[1] ?? model)
				: model;
			const def = models.find((m) => m.id === modelId);
			if (def?.output?.includes("video")) {
				onVideoModelSelected?.(modelId);
				return;
			}
			setSelectedModel(model);
			onModelChange?.(model);
		},
		[onModelChange, onVideoModelSelected, models],
	);
	const [comparisonChatId, setComparisonChatId] = useState<string | null>(
		initialChatId,
	);
	const comparisonChatIdRef = useRef<string | null>(initialChatId);
	const loadedComparisonChatIdRef = useRef<string | null>(null);
	const [reasoningEffort, setReasoningEffort] = useState<
		"" | "minimal" | "low" | "medium" | "high"
	>("");
	const [imageAspectRatio, setImageAspectRatio] = useState<
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
		| "21:9"
		| "1:4"
		| "4:1"
		| "1:8"
		| "8:1"
	>("auto");
	const [imageSize, setImageSize] = useState<string>("1K");
	const [alibabaImageSize, setAlibabaImageSize] = useState<string>(() => {
		const config = getModelImageConfig(initialModel);
		return config.isGptImage ? config.defaultSize : "1024x1024";
	});
	const [imageQuality, setImageQuality] = useState<string>(() => {
		const config = getModelImageConfig(initialModel);
		return config.defaultQuality ?? "auto";
	});
	const [imageCount, setImageCount] = useState<1 | 2 | 3 | 4>(1);
	const [webSearchEnabled, setWebSearchEnabled] = useState(false);
	const [activeSkills, setActiveSkills] = useState<Skill[]>([]);
	const [text, setText] = useState("");

	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const createChat = useCreateChat({ silent: true });
	const addMessage = useAddMessage();
	const forkChatMutation = useForkChat();
	const { data: comparisonChatData } = useDataChat(comparisonChatId ?? "");

	const ensureComparisonChat = useCallback(
		async (content: string): Promise<string> => {
			if (comparisonChatIdRef.current) {
				return comparisonChatIdRef.current;
			}
			const parentId = primaryChatIdRef.current ?? primaryChatId;
			if (!parentId) {
				throw new Error(
					"Cannot create comparison chat before the primary chat exists",
				);
			}
			const title = content.slice(0, 50) + (content.length > 50 ? "..." : "");
			const data = await createChat.mutateAsync({
				body: {
					title,
					model: selectedModel,
					parentChatId: parentId,
				},
			});
			const id = data.chat.id;
			setComparisonChatId(id);
			comparisonChatIdRef.current = id;
			return id;
		},
		[createChat, selectedModel, primaryChatId],
	);

	const { messages, setMessages, sendMessage, status, stop, regenerate } =
		useChat({
			onError: async (e) => {
				const msg = getErrorMessage(e);
				toast.error(msg);
			},
			onFinish: async ({ message }) => {
				const chatId = comparisonChatIdRef.current;
				if (!chatId) {
					return;
				}

				const textContent = message.parts
					.filter((p) => p.type === "text")
					.map((p) => p.text)
					.join("");

				const reasoningContent = message.parts
					.filter((p) => p.type === "reasoning")
					.map((p) => p.text)
					.join("");

				const toolParts = message.parts.filter(isToolPart);
				const metadata = parsePlaygroundMessageMetadata(message.metadata);

				const bodyToSave = {
					role: "assistant" as const,
					content: textContent || undefined,
					reasoning: reasoningContent || undefined,
					tools: toolParts.length > 0 ? JSON.stringify(toolParts) : undefined,
					...(metadata ? { metadata } : {}),
				};

				try {
					await addMessage.mutateAsync({
						params: { path: { id: chatId } },
						body: bodyToSave,
					});
				} catch (error) {
					toast.error(
						`Failed to save comparison response: ${getErrorMessage(error)}`,
					);
				}
			},
		});

	const handleForkComparisonChat = useCallback(async () => {
		if (
			forkChatMutation.isPending ||
			!comparisonChatId ||
			status === "submitted" ||
			status === "streaming"
		) {
			return;
		}
		try {
			const data = await forkChatMutation.mutateAsync({
				params: { path: { id: comparisonChatId } },
			});
			const params = new URLSearchParams(searchParams.toString());
			params.set("id", data.chat.id);
			params.delete("compare");
			router.push(`${pathname}?${params.toString()}`);
			toast.success("Chat forked");
		} catch {}
	}, [
		forkChatMutation,
		comparisonChatId,
		status,
		router,
		pathname,
		searchParams,
	]);

	const supportsImages = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.vision);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.vision;
	}, [models, selectedModel]);

	const supportsImageGen = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { modelId } = parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		return !!def?.output?.includes("image");
	}, [models, selectedModel]);

	const supportsAudio = useMemo(() => {
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.audio;
	}, [availableModels, selectedModel]);

	const supportsDocuments = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.document);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.document;
	}, [models, selectedModel]);

	const supportsReasoning = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.reasoning);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.reasoning;
	}, [models, selectedModel]);

	const supportsWebSearch = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const { providerId, modelId, region } =
			parseModelSelectorValue(selectedModel);
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.webSearch);
		}
		const mapping = getSelectedMapping(def, providerId, region);
		return !!mapping?.webSearch;
	}, [models, selectedModel]);

	useEffect(() => {
		const config = getModelImageConfig(selectedModel);
		if (config.usesPixelDimensions) {
			if (!config.availableSizes.includes(alibabaImageSize as never)) {
				setAlibabaImageSize(config.defaultSize);
			}
		} else if (!config.availableSizes.includes(imageSize as never)) {
			setImageSize(config.defaultSize);
		}
		if (
			config.supportsQuality &&
			!(config.availableQualities as readonly string[]).includes(imageQuality)
		) {
			setImageQuality(config.defaultQuality ?? "auto");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedModel]);

	const effectiveSkills =
		syncInput && syncedActiveSkills ? syncedActiveSkills : activeSkills;

	const buildRequestOptions = useCallback(
		(hasImageAttachments: boolean, options?: any) => {
			// Only use image gen when the model supports it AND user didn't attach images for vision
			const useImageGen =
				supportsImageGen && !(supportsImages && hasImageAttachments);

			// Check if model uses WIDTHxHEIGHT format (Alibaba, ZAI, or OpenAI gpt-image)
			const isGptImage =
				selectedModel.toLowerCase().includes("gpt-image") ||
				selectedModel.toLowerCase().includes("openai/gpt-image");
			const usesPixelDimensions =
				isGptImage ||
				selectedModel.toLowerCase().includes("alibaba") ||
				selectedModel.toLowerCase().includes("qwen-image") ||
				selectedModel.toLowerCase().includes("zai") ||
				selectedModel.toLowerCase().includes("cogview");

			// Always forward the user's quality choice (including "auto") so it
			// surfaces in the activity log; the gateway treats "auto" as a no-op
			// upstream.
			const includeQuality = isGptImage && !!imageQuality;

			// Always send n explicitly to prevent providers from defaulting to >1
			const imageConfig = useImageGen
				? usesPixelDimensions
					? {
							...(isGptImage
								? alibabaImageSize !== "auto" && {
										image_size: alibabaImageSize,
									}
								: alibabaImageSize !== "1024x1024" && {
										image_size: alibabaImageSize,
									}),
							...(includeQuality && { image_quality: imageQuality }),
							n: imageCount,
						}
					: {
							...(imageAspectRatio !== "auto" && {
								aspect_ratio: imageAspectRatio,
							}),
							...(imageSize !== "1K" && { image_size: imageSize }),
							n: imageCount,
						}
				: undefined;

			const noFallback = shouldDisableFallback(selectedModel);

			return {
				...options,
				headers: {
					...(options?.headers ?? {}),
					...(noFallback ? { "x-no-fallback": "true" } : {}),
				},
				body: {
					...(options?.body ?? {}),
					model: selectedModel,
					...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
					...(imageConfig ? { image_config: imageConfig } : {}),
					...(useImageGen ? { is_image_gen: true } : {}),
					...(webSearchEnabled && supportsWebSearch
						? { web_search: true }
						: {}),
					...(effectiveSkills.length > 0
						? {
								skill_instructions: effectiveSkills
									.filter((s) => s.enabled)
									.map((s) => s.instructions)
									.join("\n\n"),
							}
						: {}),
				},
			};
		},
		[
			reasoningEffort,
			supportsImageGen,
			supportsImages,
			imageAspectRatio,
			imageSize,
			alibabaImageSize,
			imageQuality,
			imageCount,
			selectedModel,
			webSearchEnabled,
			supportsWebSearch,
			effectiveSkills,
		],
	);

	const sendMessageWithHeaders = useCallback(
		(message: any, options?: any) => {
			const hasImageAttachments = message.parts?.some(
				(p: any) => p.type === "file" && p.mediaType?.startsWith("image/"),
			);
			return sendMessage(
				message,
				buildRequestOptions(!!hasImageAttachments, options),
			);
		},
		[sendMessage, buildRequestOptions],
	);

	const regenerateWithHeaders = useCallback(
		(options?: any) => {
			const lastUserMessage = [...messages]
				.reverse()
				.find((m) => m.role === "user");
			const hasImageAttachments = lastUserMessage?.parts?.some(
				(p: any) =>
					(p.type === "file" && p.mediaType?.startsWith("image/")) ||
					p.type === "image_url",
			);
			return regenerate(buildRequestOptions(!!hasImageAttachments, options));
		},
		[regenerate, messages, buildRequestOptions],
	);

	const effectiveText = syncInput ? syncedText : text;
	const handleSetText = (value: string) => {
		if (syncInput) {
			setSyncedText(value);
		}
		setText(value);
	};

	const handlePanelUserMessage = useCallback(
		async (content: string): Promise<{ id: string } | undefined> => {
			if (syncInput && onSyncedSubmitFromPanel) {
				await onSyncedSubmitFromPanel(content);
				return undefined;
			}
			const trimmed = content.trim();
			if (!trimmed) {
				return undefined;
			}
			try {
				const chatId = await ensureComparisonChat(trimmed);
				const savedMessage = await addMessage.mutateAsync({
					params: { path: { id: chatId } },
					body: { role: "user", content: trimmed },
				});
				return savedMessage.message;
			} catch {
				return undefined;
			}
		},
		[syncInput, onSyncedSubmitFromPanel, ensureComparisonChat, addMessage],
	);

	// When the primary chat is reset (New Chat), clear this panel's messages,
	// input, and chatId so it starts fresh.
	useEffect(() => {
		if (!resetToken) {
			return;
		}
		setText("");
		setSyncedText("");
		setMessages([]);
		setComparisonChatId(null);
		comparisonChatIdRef.current = null;
		loadedComparisonChatIdRef.current = null;
	}, [resetToken, setSyncedText, setMessages]);

	// Load historical messages when restoring a comparison panel from history.
	// Skip for fresh chats (no initialChatId) — those get messages from streaming
	// and calling setMessages here would overwrite streamed messages that carry metadata.
	useEffect(() => {
		if (
			!initialChatId ||
			!comparisonChatData?.messages ||
			!comparisonChatId ||
			loadedComparisonChatIdRef.current === comparisonChatId
		) {
			return;
		}
		loadedComparisonChatIdRef.current = comparisonChatId;

		if (comparisonChatData.chat.model) {
			setSelectedModel(comparisonChatData.chat.model);
			onModelChange?.(comparisonChatData.chat.model);
		}

		const filteredMessages = comparisonChatData.messages.filter(
			(msg, index, arr) =>
				msg.role !== "assistant" || arr[index + 1]?.role !== "assistant",
		);
		setMessages(
			filteredMessages.map((msg) => {
				const parts: any[] = [];
				if (msg.content) {
					parts.push({ type: "text", text: msg.content });
				}
				if ((msg as any).reasoning) {
					parts.push({ type: "reasoning", text: (msg as any).reasoning });
				}
				if ((msg as any).tools) {
					try {
						const parsedTools = JSON.parse((msg as any).tools);
						if (Array.isArray(parsedTools)) {
							parts.push(...parsedTools.map((t: any) => ({ ...t })));
						}
					} catch {
						// ignore malformed tools
					}
				}
				const metadata = parsePlaygroundMessageMetadata((msg as any).metadata);
				return {
					id: msg.id,
					role: msg.role,
					content: msg.content ?? "",
					parts,
					...(metadata ? { metadata } : {}),
				};
			}),
		);
	}, [
		initialChatId,
		comparisonChatId,
		comparisonChatData,
		setMessages,
		setSelectedModel,
		onModelChange,
	]);

	// Allow the parent to trigger a user message in this panel when
	// syncInput is enabled and the primary window is submitted.
	useEffect(() => {
		if (!onRegisterExternalSubmit) {
			return;
		}

		const submitFromPrimary = async (content: string) => {
			const trimmed = content.trim();
			if (!trimmed) {
				return;
			}

			const chatId = await ensureComparisonChat(trimmed);

			const savedMessage = await addMessage.mutateAsync({
				params: { path: { id: chatId } },
				body: { role: "user", content: trimmed },
			});

			const parts: any[] = [{ type: "text", text: trimmed }];

			await sendMessageWithHeaders(
				{
					id: savedMessage.message.id,
					role: "user",
					parts,
				},
				{
					body: {
						model: selectedModel,
					},
				},
			);
		};

		onRegisterExternalSubmit(submitFromPrimary);
	}, [
		onRegisterExternalSubmit,
		sendMessageWithHeaders,
		selectedModel,
		ensureComparisonChat,
		addMessage,
	]);

	return (
		<div className="flex flex-col h-full min-h-0 rounded-lg border bg-background">
			<div className="shrink-0 border-b bg-muted/40 px-3 py-2 flex items-center justify-between gap-2">
				<span className="text-xs font-medium text-muted-foreground">
					Model {panelIndex}
				</span>
				<div className="w-full max-w-xs">
					<ModelSelector
						models={models}
						providers={providers}
						value={selectedModel}
						onValueChange={handleModelChange}
						placeholder="Select a model..."
					/>
				</div>
			</div>
			<div className="flex-1 min-h-0">
				<ChatUI
					messages={messages}
					supportsImages={supportsImages}
					supportsAudio={supportsAudio}
					supportsDocuments={supportsDocuments}
					supportsImageGen={supportsImageGen}
					sendMessage={sendMessageWithHeaders}
					selectedModel={selectedModel}
					text={effectiveText}
					setText={handleSetText}
					status={status}
					stop={stop}
					regenerate={regenerateWithHeaders}
					reasoningEffort={reasoningEffort}
					setReasoningEffort={setReasoningEffort}
					supportsReasoning={supportsReasoning}
					imageAspectRatio={imageAspectRatio}
					setImageAspectRatio={setImageAspectRatio}
					imageSize={imageSize}
					setImageSize={setImageSize}
					alibabaImageSize={alibabaImageSize}
					setAlibabaImageSize={setAlibabaImageSize}
					imageQuality={imageQuality}
					setImageQuality={setImageQuality}
					imageCount={imageCount}
					setImageCount={setImageCount}
					supportsWebSearch={supportsWebSearch}
					webSearchEnabled={webSearchEnabled}
					setWebSearchEnabled={setWebSearchEnabled}
					onUserMessage={handlePanelUserMessage}
					forkChat={
						comparisonChatId && status === "ready"
							? handleForkComparisonChat
							: undefined
					}
					isForkingChat={forkChatMutation.isPending}
					isLoading={isParentLoading && messages.length === 0}
					error={null}
					activeSkills={
						syncInput && syncedActiveSkills ? syncedActiveSkills : activeSkills
					}
					onSelectSkill={(skill) => {
						if (syncInput && setSyncedActiveSkills && syncedActiveSkills) {
							if (!syncedActiveSkills.some((s) => s.id === skill.id)) {
								setSyncedActiveSkills([...syncedActiveSkills, skill]);
							}
						} else {
							setActiveSkills((prev) =>
								prev.some((s) => s.id === skill.id) ? prev : [...prev, skill],
							);
						}
					}}
					onRemoveSkill={(id) => {
						if (syncInput && setSyncedActiveSkills && syncedActiveSkills) {
							setSyncedActiveSkills(
								syncedActiveSkills.filter((s) => s.id !== id),
							);
						} else {
							setActiveSkills((prev) => prev.filter((s) => s.id !== id));
						}
					}}
				/>
			</div>
		</div>
	);
}
