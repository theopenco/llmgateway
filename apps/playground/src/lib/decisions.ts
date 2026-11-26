import { buildDecisionInput } from "@llmgateway/shared/decision-studio";

import type {
	DecisionGalleryItem,
	DecisionQuestion,
} from "@llmgateway/shared/decision-studio";

export * from "@llmgateway/shared/decision-studio";

// Questions carry a client-only id while they are edited so React keys stay
// stable as rows are added, removed and reordered.
export type DecisionQuestionDraft = DecisionQuestion & { id: string };

export function toQuestionDrafts(
	questions: readonly DecisionQuestion[],
): DecisionQuestionDraft[] {
	return questions.map((question) => ({
		...question,
		id: crypto.randomUUID(),
	}));
}

export function fromQuestionDrafts(
	drafts: readonly DecisionQuestionDraft[],
): DecisionQuestion[] {
	return drafts.map(({ id: _id, ...question }) => question);
}

/** Today's runs show the time; anything older needs the date too. */
export function formatRunTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	const isToday = date.toDateString() === new Date().toDateString();
	return isToday
		? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		: date.toLocaleString([], {
				month: "short",
				day: "numeric",
				hour: "numeric",
				minute: "2-digit",
			});
}

/** The sidebar label for a run: its title, else the start of its input. */
export function decisionItemLabel(item: DecisionGalleryItem): string {
	const title = item.title?.trim();
	if (title) {
		return title;
	}
	const text = item.prompt.trim().replace(/\s+/g, " ");
	return text.length > 80 ? `${text.slice(0, 80)}…` : text || "Untitled run";
}

/**
 * Serializes a run as the request body for the public API. Attached images
 * are replaced by a placeholder data URL so the snippet stays readable.
 */
export function decisionRequestSnippet(
	item: DecisionGalleryItem,
	modelId: string,
): string {
	const body = {
		model: modelId,
		input: buildDecisionInput(
			item.prompt,
			(item.inputImages ?? []).map(() => ({
				dataUrl: "data:image/png;base64,…",
				mediaType: "image/png",
			})),
		),
		questions: item.questions,
	};
	return [
		'curl -X POST "https://api.llmgateway.io/v1/decisions" \\',
		'  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \\',
		'  -H "Content-Type: application/json" \\',
		`  -d '${JSON.stringify(body, null, 2).replace(/'/g, "'\\''")}'`,
	].join("\n");
}
