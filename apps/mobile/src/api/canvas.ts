import { streamCompletion } from "@/api/completion";

import { catalog } from "@llmgateway/canvas/catalog";
import { parseCanvas, partialCanvas } from "@llmgateway/canvas/spec";

import type { Spec } from "@llmgateway/canvas/spec";

export async function generateCanvas({
	projectId,
	model,
	prompt,
	signal,
	onProgress,
}: {
	projectId: string;
	model: string;
	prompt: string;
	signal: AbortSignal;
	onProgress: (text: string, spec: Spec | null) => void;
}) {
	if (!prompt.trim()) {
		throw new Error("Describe the canvas you want to create.");
	}
	let text = "";
	let updated = 0;
	await streamCompletion({
		projectId,
		model,
		signal,
		messages: [
			{ role: "system", content: catalog.prompt() },
			{ role: "user", content: prompt.trim() },
		],
		onDelta: (delta) => {
			text += delta.content;
			if (delta.content && Date.now() - updated > 80) {
				updated = Date.now();
				onProgress(text, partialCanvas(text));
			}
		},
	});
	const spec = parseCanvas(text);
	onProgress(JSON.stringify(spec, null, 2), spec);
	return spec;
}
