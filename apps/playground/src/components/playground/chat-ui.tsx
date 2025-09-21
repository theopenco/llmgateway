import {
	Conversation,
	ConversationContent,
	ConversationEmptyState,
} from "@/components/ai-elements/conversation";
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
import {
	Message,
	MessageAvatar,
	MessageContent,
} from "@/components/ai-elements/message";
import type {
	UIDataTypes,
	UITools,
	UIMessage,
	FileUIPart,
	ChatRequestOptions,
	ChatStatus,
} from "ai";

type ChatUIProps = {
	messages: UIMessage<unknown, UIDataTypes, UITools>[];
	supportsImages: boolean;
	sendMessage: (
		message?:
			| (Omit<UIMessage<unknown, UIDataTypes, UITools>, "id" | "role"> & {
					id?: string | undefined;
					role?: "system" | "user" | "assistant" | undefined;
			  } & {
					text?: never;
					files?: never;
					messageId?: string;
			  })
			| {
					text: string;
					files?: FileList | FileUIPart[];
					metadata?: unknown;
					parts?: never;
					messageId?: string;
			  }
			| {
					files: FileList | FileUIPart[];
					metadata?: unknown;
					parts?: never;
					messageId?: string;
			  }
			| undefined,
		options?: ChatRequestOptions,
	) => Promise<void>;
	userApiKey: string | null;
	selectedModel: string;
	text: string;
	setText: (text: string) => void;
	status: ChatStatus;
	stop: () => void;
};

export const ChatUI = ({
	messages,
	supportsImages,
	sendMessage,
	userApiKey,
	selectedModel,
	text,
	setText,
	status,
	stop,
}: ChatUIProps) => {
	return (
		<div className="flex flex-col flex-1 px-4">
			<div className="flex-1 overflow-hidden">
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
			</div>

			<div className="flex-shrink-0">
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
							body: { apiKey: userApiKey, model: selectedModel },
						});
						setText("");
					}}
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
		</div>
	);
};
