import { describe, expect, it } from "vitest";

import { inspectImmediateStreamingProviderError } from "./chat.js";

describe("inspectImmediateStreamingProviderError", () => {
	it("classifies stream read failures as upstream errors", async () => {
		const response = new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					throw new Error("stream read failed");
				},
			}),
		);

		const result = await inspectImmediateStreamingProviderError(
			response,
			"openai",
		);

		expect(result.immediateError).toEqual({
			errorCode: "stream_read_error",
			errorMessage: "stream read failed",
			errorResponseText: "",
			errorType: "upstream_error",
			inferredStatusCode: 502,
			statusText: "stream_read_error",
		});
	});
});
