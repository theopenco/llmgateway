import { SSEDecoder } from "@/api/sse";

export function xhrStreamFetch(onEvent: (payload: string) => void) {
	return async (input: Request): Promise<Response> => {
		const body = await input.text();
		input.signal.throwIfAborted();
		return await new Promise((resolve, reject) => {
			const request = new XMLHttpRequest();
			const decoder = new SSEDecoder();
			let offset = 0;
			let ended = false;
			let finished = false;
			const cleanup = () => input.signal.removeEventListener("abort", abort);
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
			request.open(input.method, input.url);
			input.headers.forEach((value, key) =>
				request.setRequestHeader(key, value),
			);
			request.timeout = 300_000;
			const consume = () => {
				if (ended || request.status !== 200) {
					return;
				}
				const chunk = request.responseText.slice(offset);
				offset = request.responseText.length;
				try {
					for (const payload of decoder.push(chunk)) {
						if (payload === "[DONE]") {
							finished = true;
						} else {
							onEvent(payload);
						}
					}
				} catch (cause) {
					fail(
						cause instanceof Error
							? cause
							: new Error("The response could not be read."),
					);
				}
			};
			request.onprogress = consume;
			request.onload = () => {
				consume();
				if (ended) {
					return;
				}
				if (request.status < 200 || request.status > 599) {
					fail(new Error("Check your connection and try again."));
					return;
				}
				if (request.status === 200 && !finished) {
					fail(new Error("The response was interrupted. Please try again."));
					return;
				}
				try {
					const response = new Response(
						[204, 205, 304].includes(request.status)
							? null
							: request.responseText,
						{
							status: request.status,
							headers: {
								"Content-Type":
									request.getResponseHeader("Content-Type") ?? "text/plain",
							},
						},
					);
					ended = true;
					cleanup();
					resolve(response);
				} catch (cause) {
					fail(
						cause instanceof Error
							? cause
							: new Error("The response could not be read."),
					);
				}
			};
			request.onerror = () =>
				fail(new Error("Check your connection and try again."));
			request.ontimeout = () =>
				fail(new Error("The response took too long. Please try again."));
			input.signal.addEventListener("abort", abort, { once: true });
			if (input.signal.aborted) {
				abort();
			} else {
				request.send(body);
			}
		});
	};
}
