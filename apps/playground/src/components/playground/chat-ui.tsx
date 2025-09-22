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
import { Avatar, AvatarFallback } from "@radix-ui/react-avatar";
import { useUser } from "@/hooks/useUser";
import { Bot, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { toast } from "sonner";

type ChatUIProps = {
	messages: UIMessage[];
	supportsImages: boolean;
	sendMessage: (
		message: UIMessage,
		options?: ChatRequestOptions,
	) => Promise<void>;
	userApiKey: string | null;
	selectedModel: string;
	text: string;
	setText: (text: string) => void;
	status: ChatStatus;
	stop: () => void;
	onUserMessage?: (
		content: string,
		images?: Array<{
			type: "image_url";
			image_url: {
				url: string;
			};
		}>,
	) => Promise<void>;
	isLoading?: boolean;
	error?: string | null;
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
	onUserMessage,
	isLoading = false,
	error = null,
}: ChatUIProps) => {
	const { user } = useUser();

	return (
		<div className="flex flex-col flex-1 px-4">
			<div className="flex-1 overflow-hidden">
				<Conversation>
					<ConversationContent>
						{messages.length === 0 ? (
							<ConversationEmptyState description="Start chatting with any model. Add images too." />
						) : (
							messages.map((m) => (
								<Message key={m.id} from={m.role}>
									<MessageContent variant="flat">
										{m.parts.map((p, i) => {
											if (p.type === "text") {
												return <div key={i}>{p.text}</div>;
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
				{error && (
					<Alert variant="destructive" className="mb-4">
						<AlertCircle className="h-4 w-4" />
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				<PromptInput
					accept={supportsImages ? "image/*" : undefined}
					multiple
					globalDrop
					aria-disabled={isLoading || status === "streaming"}
					onSubmit={async (message) => {
						if (isLoading || status === "streaming") return;

						try {
							const textContent = message.text ?? "";
							if (onUserMessage) {
								await onUserMessage(textContent);
							}
							sendMessage(
								{
									id: crypto.randomUUID(),
									role: "user",
									parts: [{ type: "text", text: textContent }],
								},
								{
									body: {
										apiKey: userApiKey,
										model: selectedModel,
									},
								},
							);
							setText("");
						} catch (error) {
							toast.error("Could not send message after failing to save it.");
						}
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
								<PromptInputSubmit status={status} disabled={isLoading} />
							</div>
						</PromptInputToolbar>
					</PromptInputBody>
				</PromptInput>
			</div>
		</div>
	);
};
