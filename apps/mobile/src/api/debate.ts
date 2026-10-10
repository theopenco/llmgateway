import { streamCompletion } from "@/api/completion";
import { mergeSources } from "@/api/sources";

import type { Source } from "@/api/sources";
import type { ChatSettings } from "@/lib/preferences";

export const DEBATE_TURNS = 5;
export interface DebateTurn {
	createdAt: string;
	model: string;
	content: string;
	reasoning: string;
	sources: Source[];
	finished: boolean;
	interrupted?: boolean;
	error?: string;
}

export async function runDebate({
	projectId,
	models,
	topic,
	turns,
	settings,
	signal,
	onTurn,
}: {
	projectId: string;
	models: string[];
	topic: string;
	turns: DebateTurn[];
	settings: ChatSettings;
	signal: AbortSignal;
	onTurn: (index: number, turn: DebateTurn) => void;
}): Promise<void> {
	if (
		!topic.trim() ||
		models.length < 2 ||
		models.length > 5 ||
		new Set(models).size !== models.length
	) {
		throw new Error("Enter a topic and choose two to five different models.");
	}
	let previous = turns.at(-1)?.content ?? "";
	for (
		let index = turns.length;
		index < DEBATE_TURNS && !signal.aborted;
		index++
	) {
		let turn: DebateTurn = {
			createdAt: new Date().toISOString(),
			model: models[index % models.length],
			content: "",
			reasoning: "",
			sources: [],
			finished: false,
		};
		onTurn(index, turn);
		try {
			await streamCompletion({
				projectId,
				model: turn.model,
				settings,
				signal,
				messages: [
					{
						role: "system",
						content: [
							settings.systemPrompt,
							"Discuss the user's topic with another model. Give a concise argument. Take a clear stance on the first turn, then challenge the previous argument thoughtfully.",
						]
							.filter(Boolean)
							.join("\n\n"),
					},
					{
						role: "user",
						content: previous
							? `Topic: ${topic}\n\nPrevious argument:\n${previous}\n\nGive your counterargument.`
							: topic,
					},
				],
				onDelta: (delta) => {
					turn = {
						...turn,
						content: turn.content + delta.content,
						reasoning: turn.reasoning + delta.reasoning,
						sources: mergeSources(turn.sources, delta.sources ?? []),
					};
					onTurn(index, turn);
				},
			});
			turn = { ...turn, finished: true };
			onTurn(index, turn);
			previous = turn.content;
		} catch (error) {
			if (signal.aborted) {
				onTurn(index, { ...turn, finished: true, interrupted: true });
				return;
			}
			const message =
				error instanceof Error
					? error.message
					: "This model could not respond.";
			onTurn(index, { ...turn, finished: true, error: message });
			throw new Error(message, { cause: error });
		}
	}
}
