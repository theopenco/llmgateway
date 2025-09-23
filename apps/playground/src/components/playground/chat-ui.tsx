import { Message, MessageContent } from "@/components/ai-elements/message";
import type { UIMessage, ChatRequestOptions, ChatStatus } from "ai";
import { useUser } from "@/hooks/useUser";
import { AlertCircle } from "lucide-react";
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
import { Response } from "@/components/ai-elements/response";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

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

const suggestions = [
	"Write a Python script to analyze CSV data and create visualizations",
	"Create a compelling elevator pitch for a sustainable fashion startup",
	"Explain quantum computing like I'm 12 years old",
	"Design a 7-day workout plan for busy professionals",
	"Write a short mystery story in exactly 100 words",
	"Debug this React component and suggest performance improvements",
	"Plan the perfect weekend in Tokyo for first-time visitors",
	"Generate creative Instagram captions for a coffee shop",
	"Analyze the pros and cons of different programming languages",
	"Create a meal prep plan for someone with a nut allergy",
];

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
							<div className="max-w-4xl mx-auto">
								<Suggestions>
									{suggestions.map((suggestion) => (
										<Suggestion
											key={suggestion}
											onClick={() => setText(suggestion)}
											suggestion={suggestion}
										/>
									))}
								</Suggestions>
								<ConversationEmptyState description="Start chatting with any model from any provider." />
							</div>
						) : (
							messages.map((m) =>
								m.role === "assistant" ? (
									<Response key={m.id}>
										{m.parts
											.filter((p) => p.type === "text")
											.map((p) => p.text)
											.join("")}
									</Response>
								) : (
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
								),
							)
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
