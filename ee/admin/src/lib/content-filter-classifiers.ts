const CLASSIFIER_LABELS: Record<string, string> = {
	openai: "OpenAI moderation",
	jev: "Jev (TypeSafe)",
	internal: "Internal classifier",
};

const SCOPE_LABELS: Record<string, string> = {
	full: "whole conversation",
	latest_turn: "latest turn",
};

export interface ClassifierKey {
	classifier: string;
	internalScope: string;
}

/** CSS-safe series id, one per (classifier, internal scope). */
export function classifierSeriesKey({
	classifier,
	internalScope,
}: ClassifierKey): string {
	const key = internalScope ? `${classifier}_${internalScope}` : classifier;
	return key.replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function classifierLabel({
	classifier,
	internalScope,
}: ClassifierKey): string {
	const name = CLASSIFIER_LABELS[classifier] ?? classifier;
	return internalScope
		? `${name} · ${SCOPE_LABELS[internalScope] ?? internalScope}`
		: name;
}
