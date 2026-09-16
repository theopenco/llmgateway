import Clipboard from "@react-native-clipboard/clipboard";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Image, Linking, Text, View } from "react-native";

import { Markdown } from "@/components/Markdown";
import { Sources } from "@/components/Sources";
import { ToolCalls } from "@/components/ToolCalls";
import { Button, ErrorNotice, styles } from "@/components/ui";
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
	return (
		<View style={styles.card}>
			<Text style={styles.eyebrow}>
				{message.role === "user" ? "YOU" : "THE LOUNGE"}
			</Text>
			{!!message.reasoning && (
				<>
					<Button
						title={showReasoning ? "Hide reasoning" : "Show reasoning"}
						secondary
						onPress={() => setShowReasoning(!showReasoning)}
					/>
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
			<View style={styles.row}>
				{!!message.content && (
					<Button
						title={copiedText === message.content ? "Copied" : "Copy message"}
						secondary
						onPress={() => {
							Clipboard.setString(message.content ?? "");
							setCopiedText(message.content ?? "");
						}}
					/>
				)}
				{onEdit && (
					<Button
						title="Edit message"
						secondary
						disabled={busy}
						onPress={onEdit}
					/>
				)}
			</View>
		</View>
	);
}
