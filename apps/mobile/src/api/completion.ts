import { errorMessage } from "@/api/errors";
import { config } from "@/config";

import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import { ensureGatewayKey } from "./gateway-key";
import { SSEDecoder, parseDelta } from "./sse";

import type { CompletionDelta } from "./sse";
import type { ChatSettings } from "@/lib/preferences";

export { clearGatewayKey, ensureGatewayKey } from "./gateway-key";

export interface Message {
	role: "user" | "assistant" | "system";
	content:
		| string
		| Array<
				| { type: "text"; text: string }
				| { type: "image_url"; image_url: { url: string } }
				| { type: "input_audio"; input_audio: { data: string; format: string } }
				| { type: "file"; file: { filename: string; file_data: string } }
		  >;
}

export async function streamCompletion({
	projectId,
	model,
	messages,
	signal,
	onDelta,
	settings,
}: {
	projectId: string;
	model: string;
	messages: Message[];
	signal: AbortSignal;
	onDelta: (delta: CompletionDelta) => void;
	settings?: ChatSettings;
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
				let message = `The model request failed (${request.status}). Please try again.`;
				try {
					message = errorMessage(JSON.parse(request.responseText), message);
				} catch {
					/* Non-JSON errors retain their HTTP status. */
				}
				fail(
					new Error(
						request.status === 402
							? "Your Lounge allowance is used up. Manage your membership on the website."
							: message,
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
		request.send(
			JSON.stringify({
				model,
				messages,
				stream: true,
				temperature: settings?.temperature,
				max_tokens: settings?.maxTokens,
				...(settings?.reasoningEffort &&
					settings.reasoningEffort !== "auto" && {
						reasoning_effort: settings.reasoningEffort,
					}),
				...(settings?.webSearch && { web_search: true }),
			}),
		);
	});
}
