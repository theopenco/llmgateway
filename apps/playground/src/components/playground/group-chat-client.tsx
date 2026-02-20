"use client";

import { useChat } from "@ai-sdk/react";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useRef } from "react";

import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ModelSelector } from "@/components/model-selector";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatSidebar } from "@/components/playground/chat-sidebar";
import { GroupChatUI } from "@/components/playground/group-chat-ui";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUser } from "@/hooks/useUser";
import { mapModels } from "@/lib/mapmodels";

import { getProviderIcon } from "@llmgateway/shared/components";

import type { ApiModel, ApiProvider } from "@/lib/fetch-models";
import type { ComboboxModel, Organization, Project } from "@/lib/types";

interface GroupChatClientProps {
	models: ApiModel[];
	providers: ApiProvider[];
	organizations: Organization[];
	selectedOrganization: Organization | null;
	projects: Project[];
	selectedProject: Project | null;
}

interface GroupMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	model?: string;
	timestamp: number;
}

export default function GroupChatClient({
	models,
	providers,
	organizations,
	selectedOrganization,
	projects,
	selectedProject,
}: GroupChatClientProps) {
	const { user, isLoading: isUserLoading } = useUser();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();

	const mapped = useMemo(
		() => mapModels(models, providers),
		[models, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);

	const [selectedModels, setSelectedModels] = useState<string[]>([]);
	const [messages, setMessages] = useState<GroupMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [currentChatId] = useState<string | null>(null);
	const [initialPrompt, setInitialPrompt] = useState("");
	const maxTurns = 5; // Limit conversation length
	const turnCounterRef = useRef(0);
	const tempMessageIdRef = useRef<string | null>(null);
	const lastAssistantTextRef = useRef<string>("");
	const stoppedRef = useRef<boolean>(false);
	const messagesRef = useRef<GroupMessage[]>([]);
	const advanceScheduledRef = useRef<boolean>(false);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	const isAuthenticated = !isUserLoading && !!user;
	const showAuthDialog = !isAuthenticated && !isUserLoading && !user;

	const returnUrl = useMemo(() => {
		const search = searchParams.toString();
		return search ? `${pathname}?${search}` : pathname;
	}, [pathname, searchParams]);

	const ensuredProjectRef = useRef<string | null>(null);

	// Ensure playground key exists
	useEffect(() => {
		if (!isAuthenticated || !selectedProject) {
			ensuredProjectRef.current = null;
			return;
		}

		const ensureKey = async () => {
			if (!selectedOrganization) {
				return;
			}
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
		void ensureKey();
	}, [isAuthenticated, selectedOrganization, selectedProject]);

	const addModel = (modelId: string) => {
		if (selectedModels.length < 5 && !selectedModels.includes(modelId)) {
			setSelectedModels([...selectedModels, modelId]);
		}
	};

	const removeModel = (modelId: string) => {
		setSelectedModels(selectedModels.filter((m) => m !== modelId));
	};

	// Helper to safely schedule advancing to the next turn exactly once
	const scheduleNextTurn = () => {
		if (advanceScheduledRef.current) {
			return;
		}
		advanceScheduledRef.current = true;
		const nextTurn = turnCounterRef.current + 1;
		turnCounterRef.current = nextTurn;
		if (!stoppedRef.current && nextTurn < maxTurns) {
			setTimeout(() => {
				void continueConversation(messagesRef.current, nextTurn);
			}, 60);
		} else {
			setIsStreaming(false);
		}
	};

	// AI SDK chat hook (we'll drive turns manually and map streaming into our UI)
	const {
		messages: aiMessages,
		setMessages: setAiMessages,
		sendMessage,
		stop,
	} = useChat({
		onError: (e) => {
			// Record error text on the current temp assistant message (if any)
			setError(e.message);
			if (tempMessageIdRef.current) {
				setMessages((prev) =>
					prev.map((msg) =>
						msg.id === tempMessageIdRef.current
							? { ...msg, content: msg.content || `Error: ${e.message}` }
							: msg,
					),
				);
				// Try to use whatever partial text is present for possible next turn
				const partial = messagesRef.current.find(
					(m) => m.id === tempMessageIdRef.current,
				)?.content;
				if (partial && typeof partial === "string") {
					lastAssistantTextRef.current = partial;
				}
			}

			scheduleNextTurn();
		},
		onFinish: ({ message }) => {
			// Capture final assistant text for chaining to next turn
			const textContent = message.parts
				.filter((p: any) => p.type === "text")
				.map((p: any) => p.text)
				.join("");
			lastAssistantTextRef.current = textContent;
		},
	});

	// Reflect AI SDK streaming into the temporary assistant message for current turn
	useEffect(() => {
		if (!tempMessageIdRef.current) {
			return;
		}
		// Find latest assistant message text
		const last = [...aiMessages]
			.reverse()
			.find((m: any) => m.role === "assistant");
		if (!last) {
			return;
		}
		const text = (last.parts || [])
			.filter((p: any) => p.type === "text")
			.map((p: any) => p.text)
			.join("");
		if (typeof text !== "string") {
			return;
		}
		setMessages((prev) =>
			prev.map((msg) =>
				msg.id === tempMessageIdRef.current ? { ...msg, content: text } : msg,
			),
		);
	}, [aiMessages]);

	const startConversation = async () => {
		if (!initialPrompt.trim() || selectedModels.length < 2) {
			setError("Please enter a prompt and select at least 2 models");
			return;
		}

		setError(null);
		stoppedRef.current = false;

		// If this is the very first start (no messages yet), reset and seed
		if (messages.length === 0) {
			setMessages([]);
			setAiMessages([]);
			turnCounterRef.current = 0;
			lastAssistantTextRef.current = "";

			// Add user's initial message
			const userMessage: GroupMessage = {
				id: crypto.randomUUID(),
				role: "user",
				content: initialPrompt,
				timestamp: Date.now(),
			};

			setMessages([userMessage]);

			// Start the conversation loop
			await continueConversation([userMessage], 0);
			return;
		}

		// Continuing an existing debate: keep history and proceed from current turn
		await continueConversation(messages, turnCounterRef.current);
	};

	const continueConversation = async (
		currentMessages: GroupMessage[],
		currentTurn: number,
	) => {
		if (
			stoppedRef.current ||
			currentTurn >= maxTurns ||
			selectedModels.length === 0
		) {
			return;
		}

		setIsStreaming(true);
		advanceScheduledRef.current = false; // allow one advancement for this turn
		const modelIndex = currentTurn % selectedModels.length;
		const currentModel = selectedModels[modelIndex];

		// Create a temporary group assistant message for streaming
		const tempMessageId = crypto.randomUUID();
		tempMessageIdRef.current = tempMessageId;
		const tempMessage: GroupMessage = {
			id: tempMessageId,
			role: "assistant",
			content: "",
			model: currentModel,
			timestamp: Date.now(),
		};
		setMessages((prev) => [...prev, tempMessage]);

		// Determine the input for this turn and prepend debate instruction
		const turnInput =
			currentTurn === 0 ? initialPrompt : lastAssistantTextRef.current;
		const debateInstruction =
			currentTurn === 0
				? `Debate mode: Take a clear stance and present a concise argument on: "${initialPrompt}". Do not argue both sides.`
				: `Argue the opposing side to the previous response. Previous response: "${lastAssistantTextRef.current}". Provide a concise counter-argument.`;
		const userUiMessage = {
			id: crypto.randomUUID(),
			role: "user" as const,
			parts: [
				{ type: "text", text: debateInstruction },
				{ type: "text", text: "\n\n" + turnInput },
			],
		};

		const isProviderSpecific = currentModel.includes("/");
		const localStorageOverride =
			typeof window !== "undefined" &&
			localStorage.getItem("llmgateway_no_fallback") === "true";
		const noFallback = isProviderSpecific || localStorageOverride;

		try {
			await sendMessage(userUiMessage as any, {
				headers: {
					...(noFallback ? { "x-no-fallback": "true" } : {}),
				},
				body: {
					model: currentModel,
				},
			});
			// Advance on successful completion of this turn
			scheduleNextTurn();
		} catch (err) {
			const messageText =
				err instanceof Error ? err.message : "An error occurred";
			setError(messageText);
			// Reflect error in the temp assistant message and proceed
			if (tempMessageIdRef.current) {
				setMessages((prev) =>
					prev.map((m) =>
						m.id === tempMessageIdRef.current
							? { ...m, content: m.content || `Error: ${messageText}` }
							: m,
					),
				);
				const partial = messagesRef.current.find(
					(m) => m.id === tempMessageIdRef.current,
				)?.content;
				if (partial && typeof partial === "string") {
					lastAssistantTextRef.current = partial;
				}
			}
			scheduleNextTurn();
		}
	};

	const stopConversation = () => {
		void stop();
		setIsStreaming(false);
		turnCounterRef.current = maxTurns; // Stop the conversation
		stoppedRef.current = true;
	};

	const clearConversation = () => {
		setMessages([]);
		setAiMessages([]);
		setInitialPrompt("");
		turnCounterRef.current = 0;
		setError(null);
		stoppedRef.current = false;
		lastAssistantTextRef.current = "";
	};

	const handleSelectOrganization = (org: Organization | null) => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		if (org?.id) {
			params.set("orgId", org.id);
		} else {
			params.delete("orgId");
		}
		params.delete("projectId");
		router.push(params.toString() ? `/group?${params.toString()}` : "/group");
	};

	const handleOrganizationCreated = (org: Organization) => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		params.set("orgId", org.id);
		params.delete("projectId");
		router.push(params.toString() ? `/group?${params.toString()}` : "/group");
	};

	const handleSelectProject = (project: Project | null) => {
		if (!project) {
			return;
		}
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		params.set("orgId", project.organizationId);
		params.set("projectId", project.id);
		router.push(params.toString() ? `/group?${params.toString()}` : "/group");
	};

	const handleProjectCreated = (project: Project) => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		params.set("orgId", project.organizationId);
		params.set("projectId", project.id);
		router.push(params.toString() ? `/group?${params.toString()}` : "/group");
	};

	return (
		<SidebarProvider>
			<div className="flex h-svh bg-background w-full overflow-hidden">
				<ChatSidebar
					onNewChat={clearConversation}
					onChatSelect={() => {}}
					currentChatId={currentChatId ?? undefined}
					clearMessages={clearConversation}
					isLoading={isStreaming}
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
					<header className="shrink-0 flex items-center p-4 border-b bg-background">
						<div className="flex items-center gap-3 min-w-0 flex-1">
							<SidebarTrigger />
							<div className="flex items-center gap-2 flex-1 min-w-0">
								<h1 className="text-lg font-semibold whitespace-nowrap">
									Group Chat
								</h1>
							</div>
						</div>
						<div className="flex items-center gap-3 ml-3">
							<ThemeToggle />
							<a
								href={
									process.env.NODE_ENV === "development"
										? "http://localhost:3002/dashboard"
										: "https://llmgateway.io/dashboard"
								}
								target="_blank"
								rel="noopener noreferrer"
								className="hidden sm:inline"
							>
								<span className="text-nowrap">Dashboard</span>
							</a>
						</div>
					</header>

					<div className="flex-1 flex flex-col min-h-0 w-full max-w-4xl mx-auto overflow-hidden">
						{/* Model Selection Panel */}
						<div className="shrink-0 p-4 border-b bg-muted/30">
							<div className="space-y-3">
								<div>
									<h2 className="text-sm font-medium mb-4">
										Selected Models ({selectedModels.length}/5)
									</h2>
									{selectedModels.length < 5 && (
										<ModelSelector
											models={models}
											providers={providers}
											value=""
											onValueChange={(value) => {
												if (value) {
													addModel(value);
												}
											}}
											placeholder="Add a model..."
										/>
									)}
								</div>

								{selectedModels.length > 0 && (
									<div className="flex flex-wrap gap-2">
										{selectedModels.map((modelId) => {
											const model = availableModels.find(
												(m) => m.id === modelId,
											);
											const providerDef = providers.find(
												(p) => p.id === (model?.providerId as any),
											);
											const ProviderIcon = providerDef
												? getProviderIcon(providerDef.id)
												: null;
											const bgTint = providerDef?.color
												? `${providerDef.color}15`
												: undefined;
											const borderTint = providerDef?.color
												? `${providerDef.color}30`
												: undefined;
											return (
												<div
													key={modelId}
													className="flex items-center gap-2 pl-2 pr-1 py-1.5 border rounded-full text-sm"
													style={{
														backgroundColor: bgTint,
														borderColor: borderTint,
													}}
												>
													{ProviderIcon ? (
														<ProviderIcon
															className="h-3.5 w-3.5"
															style={{ color: providerDef?.color ?? undefined }}
														/>
													) : null}
													<span className="max-w-[220px] truncate">
														{model?.id ?? modelId}
													</span>
													<button
														type="button"
														onClick={() => removeModel(modelId)}
														className="rounded-full hover:bg-foreground/10 transition-colors p-1"
														aria-label={`Remove ${model?.id ?? modelId}`}
													>
														<X className="size-3" />
													</button>
												</div>
											);
										})}
									</div>
								)}

								{selectedModels.length === 0 && (
									<p className="text-sm text-muted-foreground">
										Add at least 2 models to start a group conversation
									</p>
								)}
							</div>
						</div>

						<GroupChatUI
							messages={messages}
							isStreaming={isStreaming}
							error={error}
							initialPrompt={initialPrompt}
							setInitialPrompt={setInitialPrompt}
							onStart={startConversation}
							onStop={stopConversation}
							onClear={clearConversation}
							selectedModels={selectedModels}
							availableModels={availableModels}
							canStart={selectedModels.length >= 2 && !isStreaming}
						/>
					</div>
				</div>
			</div>
			<AuthDialog open={showAuthDialog} returnUrl={returnUrl} />
		</SidebarProvider>
	);
}
