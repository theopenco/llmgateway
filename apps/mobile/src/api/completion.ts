import { config } from "@/config";

import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import { ensureGatewayKey } from "./gateway-key";
import { SSEDecoder, parseDelta } from "./sse";

import type { CompletionDelta } from "./sse";

export { clearGatewayKey, ensureGatewayKey } from "./gateway-key";

export interface Message {
	role: "user" | "assistant" | "system";
	content: string;
}

export async function streamCompletion({
	projectId,
	model,
	messages,
	signal,
	onDelta,
}: {
	projectId: string;
	model: string;
	messages: Message[];
	signal: AbortSignal;
	onDelta: (delta: CompletionDelta) => void;
}): Promise<void> {
	const token = await ensureGatewayKey(projectId);
	if (signal.aborted) {
		throw new Error("Response stopped.");
	}
	return await new Promise((resolve, reject) => {
		const request = new XMLHttpRequest();
		const decoder = new SSEDecoder();
		let offset = 0;
		let finished = false;
		let ended = false;
		const cleanup = () => signal.removeEventListener("abort", abort);
		const fail = (error: Error) => {
			if (ended) {
				return;
			}
			ended = true;
			cleanup();
			reject(error);
			request.abort();
		};
		const abort = () => fail(new Error("Response stopped."));
		request.open("POST", `${config.gatewayUrl}/chat/completions`);
		request.setRequestHeader("Authorization", `Bearer ${token}`);
		request.setRequestHeader("Content-Type", "application/json");
		request.setRequestHeader("x-source", LOUNGE_SOURCE);
		request.timeout = 300_000;
		const consume = () => {
			if (request.status !== 200 || ended) {
				return;
			}
			const next = request.responseText.slice(offset);
			offset = request.responseText.length;
			try {
				for (const payload of decoder.push(next)) {
					if (payload === "[DONE]") {
						finished = true;
						continue;
					}
					const delta = parseDelta(payload);
					if (delta) {
						onDelta(delta);
					}
				}
			} catch (error) {
				fail(
					error instanceof Error ? error : new Error("Invalid model response."),
				);
			}
		};
		request.onprogress = consume;
		request.onload = () => {
			consume();
			if (ended) {
				return;
			}
			if (request.status !== 200) {
				fail(
					new Error(
						request.status === 402
							? "Your Lounge allowance is used up. Manage your membership on the website."
							: `The model request failed (${request.status}). Please try again.`,
					),
				);
				return;
			}
			if (!finished) {
				fail(new Error("The response was interrupted. Please try again."));
				return;
			}
			ended = true;
			cleanup();
			resolve();
		};
		request.onerror = () =>
			fail(
				new Error(
					"Unable to reach the model. Check your connection and try again.",
				),
			);
		request.ontimeout = () =>
			fail(new Error("The model took too long to respond. Please try again."));
		signal.addEventListener("abort", abort);
		request.send(JSON.stringify({ model, messages, stream: true }));
	});
}
