import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	speechModels,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

describe("e2e speech", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(speechModels)(
		"speech $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/audio/speech", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					input: "Hello from the LLM Gateway end-to-end speech test.",
					response_format: "wav",
				}),
			});

			if (res.status !== 200) {
				const errorBody = await res.text();
				if (logMode) {
					console.log("speech error response:", errorBody);
				}
				expect(res.status, errorBody).toBe(200);
			}

			const contentType = res.headers.get("Content-Type") ?? "";
			expect(contentType).toContain("audio/");

			const bytes = Buffer.from(await res.arrayBuffer());
			if (logMode) {
				console.log(
					`speech response: ${bytes.length} bytes, content-type ${contentType}`,
				);
			}
			// A WAV file starts with a RIFF header and must carry actual audio
			// samples beyond the 44-byte header.
			expect(bytes.length).toBeGreaterThan(44);
			expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
			expect(bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");
		},
	);
});
