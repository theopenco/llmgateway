import { useState } from "react";
import { Text, View } from "react-native";

import { pendingTool, toolLabel } from "@/api/tool-parts";
import { Button, styles } from "@/components/ui";

import type { ToolPart } from "@/api/tool-parts";

function ToolCall({
	part,
	busy,
	onAnswer,
}: {
	part: ToolPart;
	busy?: boolean;
	onAnswer?: (id: string, approved: boolean) => void;
}) {
	const [expanded, setExpanded] = useState(false);
	const label = toolLabel(part);
	return (
		<View style={styles.card}>
			<Text style={styles.heading}>{label}</Text>
			<Text style={styles.muted}>
				{pendingTool(part)
					? "Review this request before it runs. Its result will be sent to the model."
					: part.state === "output-denied"
						? "Declined"
						: part.state === "output-available"
							? "Completed"
							: part.state === "output-error"
								? "Could not confirm completion"
								: "Preparing request…"}
			</Text>
			<Text selectable style={styles.body}>
				{JSON.stringify(part.input, null, 2)}
			</Text>
			{part.errorText && (
				<Text selectable style={styles.muted}>
					{part.errorText}
				</Text>
			)}
			{pendingTool(part) && onAnswer && (
				<View style={[styles.row, { flexWrap: "wrap" }]}>
					<Button
						title="Approve"
						accessibilityLabel={`Approve ${label}`}
						disabled={busy}
						onPress={() => onAnswer(part.toolCallId, true)}
					/>
					<Button
						title="Decline"
						accessibilityLabel={`Decline ${label}`}
						secondary
						disabled={busy}
						onPress={() => onAnswer(part.toolCallId, false)}
					/>
				</View>
			)}
			{part.state === "output-available" && (
				<>
					<Button
						title={expanded ? "Hide tool result" : "Show tool result"}
						secondary
						onPress={() => setExpanded(!expanded)}
					/>
					{expanded && (
						<Text selectable style={styles.body}>
							{JSON.stringify(part.output, null, 2)}
						</Text>
					)}
				</>
			)}
		</View>
	);
}

export function ToolCalls({
	parts,
	busy,
	onAnswer,
}: {
	parts: ToolPart[];
	busy?: boolean;
	onAnswer?: (id: string, approved: boolean) => void;
}) {
	return (
		<>
			{parts.map((part) => (
				<ToolCall
					key={part.toolCallId}
					part={part}
					busy={busy}
					onAnswer={onAnswer}
				/>
			))}
		</>
	);
}
