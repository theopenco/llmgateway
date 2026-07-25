import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	transcriptionModels,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_AUDIO_PATH = path.join(
	__dirname,
	"test-fixtures",
	"test-audio.wav",
);

describe("e2e transcriptions", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(transcriptionModels)(
		"transcription $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const form = new FormData();
			form.append("model", model);
			form.append("language", "en");
			form.append(
				"file",
				new File([fs.readFileSync(FIXTURE_AUDIO_PATH)], "test-audio.wav", {
					type: "audio/wav",
				}),
			);

			const res = await app.request("/v1/audio/transcriptions", {
				method: "POST",
				headers: {
					"x-request-id": requestId,
					Authorization: `Bearer real-token`,
				},
				body: form,
			});

			if (res.status !== 200) {
				const errorBody = await res.text();
				if (logMode) {
					console.log("transcription error response:", errorBody);
				}
				expect(res.status, errorBody).toBe(200);
			}

			const json = await res.json();
			if (logMode) {
				console.log("transcription response:", JSON.stringify(json));
			}
			expect(typeof json.text).toBe("string");
			// The fixture is a spoken English sentence ("The quick brown fox
			// jumps over the lazy dog."), so a working model returns a non-empty
			// transcript rather than just a well-formed empty response.
			expect(json.text.length).toBeGreaterThan(0);
			expect(json.text.toLowerCase()).toContain("fox");
			expect(typeof json.duration).toBe("number");
			expect(json.duration).toBeGreaterThan(0);
		},
	);
});
