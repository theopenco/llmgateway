import Clipboard from "@react-native-clipboard/clipboard";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";

import { Markdown } from "@/components/Markdown";
import { Sources } from "@/components/Sources";
import { ToolCalls } from "@/components/ToolCalls";
import {
	Button,
	colors,
	ErrorNotice,
	Icon,
	IconButton,
	styles,
} from "@/components/ui";
import { exportFile } from "@/lib/export-file";

import type { Attachment, ChatMessage } from "@/api/chat-messages";

export function AttachmentPreview({ attachment }: { attachment: Attachment }) {
	const open = useMutation({
		mutationFn: async () => {
			if (attachment.url.startsWith("data:")) {
				const match = attachment.url.match(/^data:[^;]+;base64,(.*)$/s);
				if (!match) {
					throw new Error("This attachment cannot be exported.");
				}
				await exportFile({ base64: match[1], name: attachment.name }, "save");
			} else if (/^https?:\/\//i.test(attachment.url)) {
				await Linking.openURL(attachment.url);
			} else {
				throw new Error("This attachment cannot be opened.");
			}
		},
	});
	return (
		<View style={{ gap: 8 }}>
			{attachment.mediaType.startsWith("image/") && (
				<Image
					accessibilityLabel={attachment.name}
					source={{ uri: attachment.url }}
					style={{ width: "100%", height: 180, borderRadius: 12 }}
					resizeMode="contain"
				/>
			)}
			<Button
				title={`${attachment.url.startsWith("data:") ? "Save" : "Open"} ${attachment.name}`}
				secondary
				busy={open.isPending}
				onPress={() => open.mutate()}
			/>
			<ErrorNotice error={open.error} />
		</View>
	);
}

export function MessageBubble({
	message,
	onEdit,
	onToolAnswer,
	busy,
}: {
	message: ChatMessage;
	onEdit?: () => void;
	onToolAnswer?: (id: string, approved: boolean) => void;
	busy?: boolean;
}) {
	const [copiedText, setCopiedText] = useState<string>();
	const [showReasoning, setShowReasoning] = useState(false);
	const isUser = message.role === "user";
	return (
		<View style={{ alignItems: isUser ? "flex-end" : "stretch", gap: 4 }}>
			<View
				style={{
					maxWidth: isUser ? "88%" : "100%",
					paddingHorizontal: isUser ? 16 : 0,
					paddingVertical: isUser ? 12 : 4,
					borderRadius: 24,
					backgroundColor: isUser ? colors.surface : "transparent",
					gap: 10,
				}}
			>
				{!!message.reasoning && (
					<>
						<Pressable
							role="button"
							aria-label={showReasoning ? "Hide reasoning" : "Show reasoning"}
							aria-expanded={showReasoning}
							style={[styles.row, { minHeight: 44, gap: 8 }]}
							onPress={() => setShowReasoning(!showReasoning)}
						>
							<Text style={styles.muted}>Reasoning</Text>
							<Icon
								name={showReasoning ? "chevron-down" : "chevron-right"}
								color="muted"
								size={14}
							/>
						</Pressable>
						{showReasoning && <Markdown>{message.reasoning}</Markdown>}
					</>
				)}
				{!!message.content &&
					(message.role === "user" ? (
						<Text selectable style={styles.body}>
							{message.content}
						</Text>
					) : (
						<Markdown>{message.content}</Markdown>
					))}
				{message.attachments.map((attachment) => (
					<AttachmentPreview key={attachment.id} attachment={attachment} />
				))}
				<ToolCalls
					parts={message.toolParts ?? []}
					busy={busy}
					onAnswer={onToolAnswer}
				/>
				<Sources sources={message.sourceLinks ?? []} />
			</View>
			<View style={[styles.row, { gap: 2 }]}>
				{!!message.content && (
					<IconButton
						name={copiedText === message.content ? "check" : "copy"}
						accessibilityLabel={
							copiedText === message.content ? "Copied" : "Copy message"
						}
						iconSize={18}
						onPress={() => {
							Clipboard.setString(message.content ?? "");
							setCopiedText(message.content ?? "");
						}}
					/>
				)}
				{onEdit && (
					<IconButton
						name="edit"
						accessibilityLabel="Edit message"
						iconSize={18}
						disabled={busy}
						onPress={onEdit}
					/>
				)}
			</View>
		</View>
	);
}
