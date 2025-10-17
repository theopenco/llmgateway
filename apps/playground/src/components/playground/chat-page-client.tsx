"use client";

import { useChat } from "@ai-sdk/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";

// Removed API key manager for playground; we rely on server-set cookie
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatHeader } from "@/components/playground/chat-header";
import { ChatSidebar } from "@/components/playground/chat-sidebar";
import { ChatUI } from "@/components/playground/chat-ui";
import { SidebarProvider } from "@/components/ui/sidebar";
// No local api key. We'll call backend to ensure key cookie exists after login.
import {
	useAddMessage,
	useChats,
	useCreateChat,
	useDataChat,
} from "@/hooks/useChats";
import { useUser } from "@/hooks/useUser";
import { parseImageFile } from "@/lib/image-utils";
import { mapModels } from "@/lib/mapmodels";

import type { ComboboxModel, Organization, Project } from "@/lib/types";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";

interface ChatPageClientProps {
	models: ModelDefinition[];
	providers: ProviderDefinition[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
}

export default function ChatPageClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects,
	selectedProject,
}: ChatPageClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
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

				// Handle file parts (AI SDK format for images)
				const fileParts = (message.parts as any[])
					.filter(
						(p: any) => p.type === "file" && p.mediaType?.startsWith("image/"),
					)
					.map((p: any) => {
						const { dataUrl } = parseImageFile(p);
						return {
							type: "image_url",
							image_url: { url: dataUrl },
						};
					});

				const images = [...imageUrlParts, ...fileParts];

				await addMessage.mutateAsync({
					params: { path: { id: chatId } },
					body: {
						role: "assistant",
						content: textContent || undefined,
						images: images.length > 0 ? JSON.stringify(images) : undefined,
						reasoning: reasoningContent || undefined,
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

		setMessages((prev) => {
			if (prev.length === 0) {
				return currentChatData.messages.map((msg) => {
					const parts: any[] = [];

					// Add text content
					if (msg.content) {
						parts.push({ type: "text", text: msg.content });
					}

					// Add reasoning if present
					if (msg.reasoning) {
						parts.push({ type: "reasoning", text: msg.reasoning });
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
							console.error("Failed to parse images:", error);
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

	// Removed showApiKeyManager

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	// After login, ensure a playground key cookie exists via backend
	useEffect(() => {
		const ensureKey = async () => {
			if (!isAuthenticated || !selectedOrganization || !selectedProject) {
				return;
			}
			try {
				await fetch("/api/ensure-playground-key", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ projectId: selectedProject.id }),
				});
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
		setError(null);
		setMessages([]);
		setCurrentChatId(chatId);
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
		let model = availableModels.find((m) => m.id === selectedModel);
		if (!model && !selectedModel.includes("/")) {
			model = availableModels.find((m) => m.id.endsWith(`/${selectedModel}`));
		}
		return !!model?.vision;
	}, [availableModels, selectedModel]);

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
					<div className="flex-shrink-0">
						<ChatHeader
							models={models}
							providers={providers}
							selectedModel={selectedModel}
							setSelectedModel={setSelectedModel}
						/>
					</div>
					<div className="flex flex-col flex-1 min-h-0 w-full max-w-3xl mx-auto overflow-hidden">
						<ChatUI
							messages={messages}
							supportsImages={supportsImages}
							sendMessage={sendMessage}
							userApiKey={null}
							selectedModel={selectedModel}
							text={text}
							setText={setText}
							status={status}
							stop={stop}
							regenerate={regenerate}
							onUserMessage={handleUserMessage}
							isLoading={isLoading || isChatLoading}
							error={error}
						/>
					</div>
				</div>
			</div>
			<AuthDialog open={showAuthDialog} />
		</SidebarProvider>
	);
}
