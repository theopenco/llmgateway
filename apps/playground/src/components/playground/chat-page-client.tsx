"use client";

import { useChat } from "@ai-sdk/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { toast } from "sonner";

// Removed API key manager for playground; we rely on server-set cookie
import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatHeader } from "@/components/playground/chat-header";
import { ChatSidebar } from "@/components/playground/chat-sidebar";
import { ChatUI } from "@/components/playground/chat-ui";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
// No local api key. We'll call backend to ensure key cookie exists after login.
import {
	useAddMessage,
	useChats,
	useCreateChat,
	useDataChat,
	useDeleteChat,
} from "@/hooks/useChats";
import { useUser } from "@/hooks/useUser";
import { parseImageFile } from "@/lib/image-utils";
import { mapModels } from "@/lib/mapmodels";
import { getErrorMessage } from "@/lib/utils";

import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@/lib/fetch-models";
import type { ComboboxModel, Organization, Project } from "@/lib/types";

interface ChatPageClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
	initialPrompt?: string;
	enableWebSearch?: boolean;
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
}: ChatPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const mapped = useMemo(
		() => mapModels(models, providers),
		[models, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	const getInitialModel = () => {
		const modelFromUrl = searchParams.get("model");
		if (modelFromUrl) {
			return modelFromUrl;
		}
		// Default to "auto" model which auto-selects the best provider
		return "auto";
	};

	const [selectedModel, setSelectedModel] = useState(getInitialModel());
	const [reasoningEffort, setReasoningEffort] = useState<
		"" | "minimal" | "low" | "medium" | "high"
	>("");
	const [imageAspectRatio, setImageAspectRatio] = useState<
		| "auto"
		| "1:1"
		| "9:16"
		| "3:4"
		| "4:3"
		| "3:2"
		| "2:3"
		| "5:4"
		| "4:5"
		| "21:9"
	>("auto");
	const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
	const [alibabaImageSize, setAlibabaImageSize] = useState<string>("1024x1024");
	const [webSearchEnabled, setWebSearchEnabled] = useState(enableWebSearch);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Get chat ID from URL search params
	const chatIdFromUrl = searchParams.get("chat");
	const [currentChatId, setCurrentChatId] = useState<string | null>(
		chatIdFromUrl,
	);
	const chatIdRef = useRef(currentChatId);
	const isNewChatRef = useRef(false);
	const panelIdCounterRef = useRef(1);
	// Flag to indicate we should clear messages on next URL change (set by handleChatSelect)
	const shouldClearMessagesRef = useRef(false);

	const { messages, setMessages, sendMessage, status, stop, regenerate } =
		useChat({
			onError: async (e) => {
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
			onFinish: async ({ message }) => {
				isNewChatRef.current = false;

				// Wait for chatId to be available (handleUserMessage might still be running)
				let chatId = chatIdRef.current;

				if (!chatId) {
					// Poll for chatId with timeout
					for (let i = 0; i < 50; i++) {
						await new Promise<void>((resolve) => {
							setTimeout(resolve, 100);
						});
						chatId = chatIdRef.current;
						if (chatId) {
							break;
						}
					}
				}

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
							p.mediaType ||
							p.mimeType ||
							p.mime_type ||
							p.file?.mediaType ||
							p.file?.mimeType ||
							p.file?.mime_type;
						return (
							typeof mediaType === "string" && mediaType.startsWith("image/")
						);
					})
					.map((p) => {
						const mediaType =
							p.mediaType ||
							p.mimeType ||
							p.mime_type ||
							p.file?.mediaType ||
							p.file?.mimeType ||
							p.file?.mime_type;
						const url =
							p.url ||
							p.data ||
							p.base64 ||
							p.file?.url ||
							p.file?.data ||
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

				// Extract tool parts (AI SDK dynamic tool UI parts)
				const toolParts = (message.parts as any[]).filter(
					(p: any) => p.type === "dynamic-tool",
				);

				const bodyToSave = {
					role: "assistant" as const,
					content: textContent || undefined,
					images: images.length > 0 ? JSON.stringify(images) : undefined,
					reasoning: reasoningContent || undefined,
					tools: toolParts.length > 0 ? JSON.stringify(toolParts) : undefined,
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
		if (chatIdFromUrl !== currentChatId) {
			// Only clear messages if explicitly requested (by handleChatSelect or handleNewChat)
			if (shouldClearMessagesRef.current) {
				setMessages([]);
				shouldClearMessagesRef.current = false;
			}
			setCurrentChatId(chatIdFromUrl);
		}
	}, [chatIdFromUrl, currentChatId, setMessages]);

	useEffect(() => {
		chatIdRef.current = currentChatId;
	}, [currentChatId]);

	const supportsImages = useMemo(() => {
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.vision;
	}, [availableModels, selectedModel]);

	const supportsImageGen = useMemo(() => {
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.imageGen;
	}, [availableModels, selectedModel]);

	const supportsReasoning = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const [providerId, modelId] = selectedModel.includes("/")
			? (selectedModel.split("/") as [string, string])
			: ["", selectedModel];
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.reasoning);
		}
		const mapping = def.mappings.find(
			(p: ApiModelProviderMapping) => p.providerId === providerId,
		);
		return !!mapping?.reasoning;
	}, [models, selectedModel]);

	const supportsWebSearch = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const [providerId, modelId] = selectedModel.includes("/")
			? (selectedModel.split("/") as [string, string])
			: ["", selectedModel];
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.webSearch);
		}
		const mapping = def.mappings.find(
			(p: ApiModelProviderMapping) => p.providerId === providerId,
		);
		return !!mapping?.webSearch;
	}, [models, selectedModel]);

	const sendMessageWithHeaders = useCallback(
		(message: any, options?: any) => {
			// Check if model uses WIDTHxHEIGHT format (Alibaba or ZAI)
			const usesPixelDimensions =
				selectedModel.toLowerCase().includes("alibaba") ||
				selectedModel.toLowerCase().includes("qwen-image") ||
				selectedModel.toLowerCase().includes("zai") ||
				selectedModel.toLowerCase().includes("cogview");

			// Only send image_config if user has explicitly selected non-default values
			const imageConfig = supportsImageGen
				? usesPixelDimensions
					? // For Alibaba/ZAI, don't send image_config with default size
						alibabaImageSize !== "1024x1024"
						? {
								image_size: alibabaImageSize,
							}
						: undefined
					: imageAspectRatio !== "auto" || imageSize !== "1K"
						? {
								...(imageAspectRatio !== "auto" && {
									aspect_ratio: imageAspectRatio,
								}),
								...(imageSize !== "1K" && { image_size: imageSize }),
							}
						: undefined
				: undefined;

			// Hidden feature: check localStorage for no-fallback setting
			const noFallback =
				typeof window !== "undefined" &&
				localStorage.getItem("llmgateway_no_fallback") === "true";

			const mergedOptions = {
				...options,
				headers: {
					...(options?.headers || {}),
					...(noFallback ? { "x-no-fallback": "true" } : {}),
				},
				body: {
					...(options?.body || {}),
					...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
					...(imageConfig ? { image_config: imageConfig } : {}),
					...(webSearchEnabled && supportsWebSearch
						? { web_search: true }
						: {}),
				},
			};

			return sendMessage(message, mergedOptions);
		},
		[
			sendMessage,
			reasoningEffort,
			supportsImageGen,
			imageAspectRatio,
			imageSize,
			alibabaImageSize,
			selectedModel,
			webSearchEnabled,
			supportsWebSearch,
		],
	);

	// Additional comparison chat windows (primary + up to two comparison panels)
	const [comparisonEnabled, setComparisonEnabled] = useState(false);
	const [extraPanelIds, setExtraPanelIds] = useState<number[]>([]);
	const [syncInput, setSyncInput] = useState(true);
	const [syncedText, setSyncedText] = useState(initialPrompt || "");
	const extraSubmitRefs = useRef<
		Record<number, (content: string) => Promise<void> | void>
	>({});
	const [comparisonResetToken, setComparisonResetToken] = useState(0);

	// Chat API hooks
	const createChat = useCreateChat();
	const addMessage = useAddMessage();
	const deleteChat = useDeleteChat();
	const { data: currentChatData, isLoading: isChatLoading } = useDataChat(
		currentChatId ?? "",
	);
	useChats();

	useEffect(() => {
		if (!currentChatData?.messages) {
			return;
		}

		// Update the selected model when loading a chat
		if (currentChatData.chat?.model) {
			setSelectedModel(currentChatData.chat.model);
		}

		// Update the web search state when loading a chat
		if (currentChatData.chat?.webSearch !== undefined) {
			setWebSearchEnabled(currentChatData.chat.webSearch);
		}

		setMessages((prev) => {
			// Load messages if empty (URL change clears messages first)
			if (prev.length === 0) {
				return currentChatData.messages.map((msg) => {
					const parts: any[] = [];

					// Add text content
					if (msg.content) {
						parts.push({ type: "text", text: msg.content });
					}

					// Add reasoning if present
					if ((msg as any).reasoning) {
						parts.push({ type: "reasoning", text: (msg as any).reasoning });
					}

					// Add images if present
					if (msg.images) {
						try {
							const parsedImages = JSON.parse(msg.images);
							// Convert saved image_url format to file format for rendering
							const imageParts = parsedImages.map((img: any) => {
								const dataUrl = img.image_url?.url || "";
								// Extract base64 and mediaType from data URL
								if (dataUrl.startsWith("data:")) {
									const [header, base64] = dataUrl.split(",");
									const mediaType =
										header.match(/data:([^;]+)/)?.[1] || "image/png";
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

					// Add tool parts if present
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
						parts,
					};
				});
			}
			return prev;
		});
	}, [currentChatData, setMessages, setSelectedModel]);

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
			if (!selectedOrganization) {
				return;
			}
			// Skip if we've already ensured the key for this project
			if (ensuredProjectRef.current === selectedProject.id) {
				return;
			}
			try {
				await fetch("/api/ensure-playground-key", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId: selectedProject.id }),
				});
				ensuredProjectRef.current = selectedProject.id;
			} catch {
				// ignore for now
			}
		};
		ensureKey();
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
				},
			});
			const newChatId = chatData.chat.id;

			setCurrentChatId(newChatId);
			chatIdRef.current = newChatId; // Manually update the ref

			// Update URL with new chat ID (without triggering navigation)
			const params = new URLSearchParams(searchParams.toString());
			params.set("chat", newChatId);
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
	) => {
		setError(null);
		setIsLoading(true);

		const isNewChat = !chatIdRef.current;
		if (isNewChat) {
			isNewChatRef.current = true;
		}

		try {
			const chatId = await ensureCurrentChat(content);

			await addMessage.mutateAsync({
				params: { path: { id: chatId } },
				body: {
					role: "user",
					...(content.trim() ? { content } : {}),
					...(images?.length ? { images: JSON.stringify(images) } : {}),
				},
			});
		} catch (error: any) {
			// If chat not found, it means the chat was deleted or is stale
			if (error?.status === 404 && error?.message?.includes("Chat not found")) {
				chatIdRef.current = null;
				setCurrentChatId(null);
				setMessages([]);

				// Try again with a new chat
				try {
					const newChatId = await ensureCurrentChat(content);
					await addMessage.mutateAsync({
						params: { path: { id: newChatId } },
						body: {
							role: "user",
							...(content.trim() ? { content } : {}),
							...(images?.length ? { images: JSON.stringify(images) } : {}),
						},
					});
					setIsLoading(false);
					return; // Exit early, don't show error
				} catch (retryError) {
					const retryErrorMessage = getErrorMessage(retryError);
					setError(retryErrorMessage);
					toast.error(retryErrorMessage);
					setIsLoading(false);
					return;
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
				return;
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
		if (syncInput) {
			const submitFns = Object.values(extraSubmitRefs.current);
			for (const submit of submitFns) {
				try {
					await submit(content);
				} catch (mirrorError) {
					// Don't surface comparison errors as hard failures
					console.warn(
						"Failed to mirror prompt to comparison window",
						mirrorError,
					);
				}
			}
		}
	};

	const clearMessages = () => {
		setError(null);
		shouldClearMessagesRef.current = true;
		setMessages([]);
		// Remove chat param from URL
		const params = new URLSearchParams(searchParams.toString());
		params.delete("chat");
		const newUrl = params.toString()
			? `${pathname}?${params.toString()}`
			: pathname;
		router.push(newUrl);
	};

	const handleNewChat = async () => {
		setIsLoading(true);
		setError(null);
		try {
			shouldClearMessagesRef.current = true;
			setMessages([]);
			// Remove chat param from URL
			const params = new URLSearchParams(searchParams.toString());
			params.delete("chat");
			const newUrl = params.toString()
				? `${pathname}?${params.toString()}`
				: pathname;
			router.push(newUrl);
			// Clear comparison windows as well
			setComparisonResetToken((token) => token + 1);
			extraSubmitRefs.current = {};
		} catch {
			setError("Failed to create new chat. Please try again.");
		} finally {
			setIsLoading(false);
		}
	};

	const handleChatSelect = (chatId: string) => {
		setError(null);
		shouldClearMessagesRef.current = true; // Request message clear on URL change
		// Update URL with chat ID - this will trigger the useEffect to update state
		const params = new URLSearchParams(searchParams.toString());
		params.set("chat", chatId);
		router.push(`${pathname}?${params.toString()}`);
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

	const [text, setText] = useState(initialPrompt || "");
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

	const handleSelectOrganization = (org: Organization | null) => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		if (org?.id) {
			params.set("orgId", org.id);
		} else {
			params.delete("orgId");
		}
		// Clear projectId to avoid 404 when switching orgs (server will pick first/last-used)
		params.delete("projectId");
		// Always keep model param
		if (!params.get("model")) {
			params.set("model", selectedModel);
		}
		router.push(params.toString() ? `/?${params.toString()}` : "/");
	};

	const handleOrganizationCreated = (org: Organization) => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		params.set("orgId", org.id);
		params.delete("projectId");
		if (!params.get("model")) {
			params.set("model", selectedModel);
		}
		router.push(params.toString() ? `/?${params.toString()}` : "/");
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
			<div className="flex h-svh bg-background w-full overflow-hidden">
				<ChatSidebar
					onNewChat={handleNewChat}
					onChatSelect={handleChatSelect}
					currentChatId={currentChatId || undefined}
					clearMessages={clearMessages}
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
				<div className="flex flex-1 flex-col w-full min-h-0 overflow-hidden">
					<div className="shrink-0">
						<ChatHeader
							models={models}
							providers={providers}
							selectedModel={selectedModel}
							setSelectedModel={setSelectedModel}
							comparisonEnabled={comparisonEnabled}
							onComparisonEnabledChange={(enabled) => {
								setComparisonEnabled(enabled);
								if (!enabled) {
									setExtraPanelIds([]);
									setComparisonResetToken((token) => token + 1);
									extraSubmitRefs.current = {};
								}
							}}
							showGlobalModelSelector={
								!(comparisonEnabled && extraPanelIds.length > 0)
							}
						/>
					</div>
					{comparisonEnabled ? (
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
										onClick={() =>
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
											})
										}
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
					<div className="flex flex-col flex-1 min-h-0 w-full overflow-hidden">
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
												onValueChange={setSelectedModel}
												placeholder="Select a model..."
											/>
										</div>
									</div>
									<div className="flex-1 min-h-0">
										<ChatUI
											messages={messages}
											supportsImages={supportsImages}
											supportsImageGen={supportsImageGen}
											sendMessage={sendMessageWithHeaders}
											selectedModel={selectedModel}
											text={primaryText}
											setText={setPrimaryText}
											status={status}
											stop={stop}
											regenerate={regenerate}
											reasoningEffort={reasoningEffort}
											setReasoningEffort={setReasoningEffort}
											supportsReasoning={supportsReasoning}
											imageAspectRatio={imageAspectRatio}
											setImageAspectRatio={setImageAspectRatio}
											imageSize={imageSize}
											setImageSize={setImageSize}
											alibabaImageSize={alibabaImageSize}
											setAlibabaImageSize={setAlibabaImageSize}
											onUserMessage={handleUserMessage}
											isLoading={isLoading || isChatLoading}
											error={error}
											setWebSearchEnabled={setWebSearchEnabled}
											supportsWebSearch={supportsWebSearch}
											webSearchEnabled={webSearchEnabled}
										/>
									</div>
								</div>
							) : (
								<div className="flex flex-col min-h-0 w-full">
									<ChatUI
										messages={messages}
										supportsImages={supportsImages}
										supportsImageGen={supportsImageGen}
										sendMessage={sendMessageWithHeaders}
										selectedModel={selectedModel}
										text={primaryText}
										setText={setPrimaryText}
										status={status}
										stop={stop}
										regenerate={regenerate}
										reasoningEffort={reasoningEffort}
										setReasoningEffort={setReasoningEffort}
										supportsReasoning={supportsReasoning}
										imageAspectRatio={imageAspectRatio}
										setImageAspectRatio={setImageAspectRatio}
										imageSize={imageSize}
										setImageSize={setImageSize}
										alibabaImageSize={alibabaImageSize}
										setAlibabaImageSize={setAlibabaImageSize}
										supportsWebSearch={supportsWebSearch}
										webSearchEnabled={webSearchEnabled}
										setWebSearchEnabled={setWebSearchEnabled}
										onUserMessage={handleUserMessage}
										isLoading={isLoading || isChatLoading}
										error={error}
										floatingInput
									/>
								</div>
							)}
							{comparisonEnabled
								? extraPanelIds.map((panelId, index) => (
										<div
											key={panelId}
											className="hidden md:flex flex-col h-full min-h-0"
										>
											<ExtraChatPanel
												panelIndex={index + 2}
												models={models}
												providers={providers}
												availableModels={availableModels}
												initialModel={selectedModel}
												syncInput={syncInput}
												syncedText={syncedText}
												setSyncedText={setSyncedText}
												onRegisterExternalSubmit={(fn) => {
													extraSubmitRefs.current[panelId] = fn;
												}}
												resetToken={comparisonResetToken}
											/>
										</div>
									))
								: null}
						</div>
					</div>
				</div>
			</div>
			<AuthDialog open={showAuthDialog} returnUrl={returnUrl} />
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
	resetToken: number;
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
	resetToken,
}: ExtraChatPanelProps) {
	const [selectedModel, setSelectedModel] = useState(initialModel);
	const [reasoningEffort, setReasoningEffort] = useState<
		"" | "minimal" | "low" | "medium" | "high"
	>("");
	const [imageAspectRatio, setImageAspectRatio] = useState<
		| "auto"
		| "1:1"
		| "9:16"
		| "3:4"
		| "4:3"
		| "3:2"
		| "2:3"
		| "5:4"
		| "4:5"
		| "21:9"
	>("auto");
	const [imageSize, setImageSize] = useState<"1K" | "2K" | "4K">("1K");
	const [alibabaImageSize, setAlibabaImageSize] = useState<string>("1024x1024");
	const [webSearchEnabled, setWebSearchEnabled] = useState(false);
	const [text, setText] = useState("");

	const { messages, sendMessage, status, stop, regenerate } = useChat({
		onError: async (e) => {
			const msg = getErrorMessage(e);
			toast.error(msg);
		},
	});

	const supportsImages = useMemo(() => {
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.vision;
	}, [availableModels, selectedModel]);

	const supportsImageGen = useMemo(() => {
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.imageGen;
	}, [availableModels, selectedModel]);

	const supportsReasoning = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const [providerId, modelId] = selectedModel.includes("/")
			? (selectedModel.split("/") as [string, string])
			: ["", selectedModel];
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.reasoning);
		}
		const mapping = def.mappings.find(
			(p: ApiModelProviderMapping) => p.providerId === providerId,
		);
		return !!mapping?.reasoning;
	}, [models, selectedModel]);

	const supportsWebSearch = useMemo(() => {
		if (!selectedModel) {
			return false;
		}
		const [providerId, modelId] = selectedModel.includes("/")
			? (selectedModel.split("/") as [string, string])
			: ["", selectedModel];
		const def = models.find((m) => m.id === modelId);
		if (!def) {
			return false;
		}
		if (!providerId) {
			return def.mappings.some((p: ApiModelProviderMapping) => p.webSearch);
		}
		const mapping = def.mappings.find(
			(p: ApiModelProviderMapping) => p.providerId === providerId,
		);
		return !!mapping?.webSearch;
	}, [models, selectedModel]);

	const sendMessageWithHeaders = useCallback(
		(message: any, options?: any) => {
			// Check if model uses WIDTHxHEIGHT format (Alibaba or ZAI)
			const usesPixelDimensions =
				selectedModel.toLowerCase().includes("alibaba") ||
				selectedModel.toLowerCase().includes("qwen-image") ||
				selectedModel.toLowerCase().includes("zai") ||
				selectedModel.toLowerCase().includes("cogview");

			// Only send image_config if user has explicitly selected non-default values
			const imageConfig = supportsImageGen
				? usesPixelDimensions
					? // For Alibaba/ZAI, don't send image_config with default size
						alibabaImageSize !== "1024x1024"
						? {
								image_size: alibabaImageSize,
							}
						: undefined
					: imageAspectRatio !== "auto" || imageSize !== "1K"
						? {
								...(imageAspectRatio !== "auto" && {
									aspect_ratio: imageAspectRatio,
								}),
								...(imageSize !== "1K" && { image_size: imageSize }),
							}
						: undefined
				: undefined;

			const noFallback =
				typeof window !== "undefined" &&
				localStorage.getItem("llmgateway_no_fallback") === "true";

			const mergedOptions = {
				...options,
				headers: {
					...(options?.headers || {}),
					...(noFallback ? { "x-no-fallback": "true" } : {}),
				},
				body: {
					...(options?.body || {}),
					...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
					...(imageConfig ? { image_config: imageConfig } : {}),
					...(webSearchEnabled && supportsWebSearch
						? { web_search: true }
						: {}),
				},
			};

			return sendMessage(message, mergedOptions);
		},
		[
			sendMessage,
			reasoningEffort,
			supportsImageGen,
			imageAspectRatio,
			imageSize,
			alibabaImageSize,
			selectedModel,
			webSearchEnabled,
			supportsWebSearch,
		],
	);

	const effectiveText = syncInput ? syncedText : text;
	const handleSetText = (value: string) => {
		if (syncInput) {
			setSyncedText(value);
		}
		setText(value);
	};

	// When the primary chat is reset (New Chat), clear this panel's messages
	// and local input as well.
	useEffect(() => {
		if (!resetToken) {
			return;
		}
		setText("");
		setSyncedText("");
	}, [resetToken, setSyncedText]);

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

			const parts: any[] = [{ type: "text", text: trimmed }];

			await sendMessageWithHeaders(
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
		};

		onRegisterExternalSubmit(submitFromPrimary);
	}, [onRegisterExternalSubmit, sendMessageWithHeaders, selectedModel]);

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
						onValueChange={setSelectedModel}
						placeholder="Select a model..."
					/>
				</div>
			</div>
			<div className="flex-1 min-h-0">
				<ChatUI
					messages={messages}
					supportsImages={supportsImages}
					supportsImageGen={supportsImageGen}
					sendMessage={sendMessageWithHeaders}
					selectedModel={selectedModel}
					text={effectiveText}
					setText={handleSetText}
					status={status}
					stop={stop}
					regenerate={regenerate}
					reasoningEffort={reasoningEffort}
					setReasoningEffort={setReasoningEffort}
					supportsReasoning={supportsReasoning}
					imageAspectRatio={imageAspectRatio}
					setImageAspectRatio={setImageAspectRatio}
					imageSize={imageSize}
					setImageSize={setImageSize}
					alibabaImageSize={alibabaImageSize}
					setAlibabaImageSize={setAlibabaImageSize}
					supportsWebSearch={supportsWebSearch}
					webSearchEnabled={webSearchEnabled}
					setWebSearchEnabled={setWebSearchEnabled}
					isLoading={false}
					error={null}
				/>
			</div>
		</div>
	);
}
