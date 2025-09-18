"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ModelDefinition, ProviderDefinition } from "@llmgateway/models";
import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@/components/ai-elements/message";
import {
	PromptInput,
	PromptInputActionAddAttachments,
	PromptInputActionMenu,
	PromptInputActionMenuContent,
	PromptInputActionMenuTrigger,
	PromptInputAttachments,
	PromptInputAttachment,
	PromptInputBody,
	PromptInputButton,
	PromptInputTextarea,
	PromptInputTools,
	PromptInputToolbar,
	PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { ThemeToggle } from "@/components/landing/theme-toggle";
import { ApiKeyManager } from "@/components/playground/api-key-manager";
import { AuthDialog } from "@/components/playground/auth-dialog";
import { ChatSidebar } from "@/components/playground/chat-sidebar";
import { ModelSelector } from "@/components/model-selector";

const LOCAL_KEY = "llmgateway_api_key";

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
	const [apiKey, setApiKey] = useState<string>("");
	const [showAuthDialog, setShowAuthDialog] = useState(false);
	const mapped = useMemo(
		() => mapModels(models, providers),
		[models, providers],
	);
	const [availableModels] = useState<ComboboxModel[]>(mapped);
	const searchParams = useSearchParams();
	const router = useRouter();
	const [selectedModel, setSelectedModel] = useState<string>(
		searchParams.get("model") || (mapped[0]?.id ?? "auto"),
	);

	// Load api key if previously saved (optional)
	useEffect(() => {
		const stored =
			typeof window !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
		if (stored) setApiKey(stored);
		else setShowApiKeyManager(true);
	}, []);

	// keep URL in sync with selected model
	useEffect(() => {
		const params = new URLSearchParams(Array.from(searchParams.entries()));
		if (selectedModel) params.set("model", selectedModel);
		else params.delete("model");
		const qs = params.toString();
		router.replace(qs ? `?${qs}` : "");
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedModel]);

	const { messages, sendMessage, status, stop } = useChat();
	const [text, setText] = useState("");

	const handleSaveApiKey = () => {
		localStorage.setItem(LOCAL_KEY, apiKey);
	};

	const supportsImages = useMemo(() => {
		const model = availableModels.find((m) => m.id === selectedModel);
		return !!model?.vision;
	}, [availableModels, selectedModel]);

	// Theme handled by ThemeToggle from @ui via next-themes

	const [showApiKeyManager, setShowApiKeyManager] = useState(false);

	return (
		<div className="mx-auto flex h-dvh w-full gap-0">
			<ChatSidebar onNewChat={() => {}} onSelect={() => {}} />
			<div className="flex flex-1 flex-col gap-2 p-4">
				<div className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 w-60">
						<ModelSelector
							models={models}
							providers={providers}
							value={selectedModel}
							onValueChange={setSelectedModel}
							placeholder="Search and select a model..."
						/>
					</div>

					<div className="flex items-center gap-2">
						<button
							className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent"
							onClick={() => setShowAuthDialog(true)}
						>
							Sign in
						</button>
						<button
							className="text-xs px-3 py-1.5 rounded-md border hover:bg-accent"
							onClick={() => setShowApiKeyManager(true)}
						>
							API Key
						</button>
						<ThemeToggle />
					</div>
				</div>

				<Conversation>
					<ConversationContent>
						{messages.length === 0 ? (
							<ConversationEmptyState description="Start chatting with any model. Add images too." />
						) : (
							messages.map((m: any) => (
								<Message key={m.id} from={m.role}>
									<MessageAvatar
										src={m.role === "user" ? "/file.svg" : "/globe.svg"}
									/>
									<MessageContent>
										{m.parts.map((p: any, i: number) => {
											if (p.type === "text") return <div key={i}>{p.text}</div>;
											if (p.type === "image" && p.image) {
												return (
													<img
														key={i}
														src={p.image.url ?? ""}
														alt={p.image.alt ?? "image"}
														className="max-w-xs rounded"
													/>
												);
											}
											if (p.type === "file" && p.url) {
												return (
													<a
														key={i}
														href={p.url}
														className="underline"
														target="_blank"
														rel="noreferrer"
													>
														{p.filename ?? "file"}
													</a>
												);
											}
											return null;
										})}
									</MessageContent>
								</Message>
							))
						)}
					</ConversationContent>
				</Conversation>

				<PromptInput
					accept={supportsImages ? "image/*" : undefined}
					multiple
					globalDrop
					onSubmit={async (message) => {
						const inputText = message.text ?? text;
						const files = message.files ?? [];
						const parts: any[] = [];
						if (inputText?.trim())
							parts.push({ type: "text", text: inputText });
						if (files.length > 0) {
							const dataUrls = await Promise.all(
								files.map(async (f: any) => {
									if (!f.url) return null;
									try {
										const res = await fetch(f.url);
										const blob = await res.blob();
										const reader = new FileReader();
										const p = new Promise<string>((resolve) => {
											reader.onloadend = () => resolve(String(reader.result));
										});
										reader.readAsDataURL(blob);
										const dataUrl = await p;
										return {
											type: "image",
											image: { url: dataUrl, alt: f.filename },
										};
									} catch {
										return null;
									}
								}),
							);
							for (const d of dataUrls) if (d) parts.push(d);
						}
						if (parts.length === 0) return;
						sendMessage({ role: "user", parts } as any, {
							body: { apiKey, model: selectedModel },
						});
						setText("");
					}}
					className="sticky bottom-0"
				>
					<PromptInputBody>
						<PromptInputTextarea
							placeholder="Message"
							value={text}
							onChange={(e) => setText(e.currentTarget.value)}
						/>
						<PromptInputAttachments>
							{(file: any) => <PromptInputAttachment data={file} />}
						</PromptInputAttachments>
						<PromptInputToolbar>
							<PromptInputTools>
								<PromptInputActionMenu>
									<PromptInputActionMenuTrigger />
									<PromptInputActionMenuContent>
										<PromptInputActionAddAttachments />
									</PromptInputActionMenuContent>
								</PromptInputActionMenu>
							</PromptInputTools>
							<div className="flex items-center gap-2">
								{status === "streaming" ? (
									<PromptInputButton onClick={() => stop()} variant="ghost">
										Stop
									</PromptInputButton>
								) : null}
								<PromptInputSubmit status={status} />
							</div>
						</PromptInputToolbar>
					</PromptInputBody>
				</PromptInput>
			</div>
			<ApiKeyManager
				open={showApiKeyManager}
				onOpenChange={setShowApiKeyManager}
				onSaved={setApiKey}
			/>
			<AuthDialog open={showAuthDialog} />
		</div>
	);
}
