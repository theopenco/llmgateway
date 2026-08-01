import { describe, expect, test } from "vitest";

import { collapseImageGenSse } from "./collapse-image-gen-sse.js";
import { getFinishReasonFromError } from "./get-finish-reason-from-error.js";

describe("collapseImageGenSse", () => {
	test("returns json from a completed event after partial events", () => {
		const text = [
			"event: image_generation.partial_image",
			`data: ${JSON.stringify({
				type: "image_generation.partial_image",
				partial_image_index: 0,
				b64_json: "PARTIAL_BYTES",
			})}`,
			"",
			"event: image_generation.completed",
			`data: ${JSON.stringify({
				type: "image_generation.completed",
				b64_json: "FINAL_BYTES",
				created_at: 1700000000,
				size: "1024x1024",
				quality: "high",
				output_format: "png",
				usage: {
					input_tokens: 12,
					output_tokens: 4321,
					input_tokens_details: { image_tokens: 0, cached_tokens: 0 },
					output_tokens_details: { image_tokens: 4321 },
					total_tokens: 4333,
				},
			})}`,
			"",
		].join("\n");

		const result = collapseImageGenSse(text);
		expect("json" in result).toBe(true);
		if (!("json" in result)) {
			return;
		}
		expect(result.json.created).toBe(1700000000);
		expect(result.json.size).toBe("1024x1024");
		expect(result.json.quality).toBe("high");
		expect(result.json.output_format).toBe("png");
		expect((result.json.data as any[])[0].b64_json).toBe("FINAL_BYTES");
		expect((result.json.usage as any).input_tokens).toBe(12);
		expect((result.json.usage as any).output_tokens).toBe(4321);
	});

	test("accepts image_edit.completed (edits endpoint event family)", () => {
		const text = [
			"event: image_edit.partial_image",
			`data: ${JSON.stringify({
				type: "image_edit.partial_image",
				partial_image_index: 0,
				b64_json: "EDIT_PARTIAL",
			})}`,
			"",
			"event: image_edit.completed",
			`data: ${JSON.stringify({
				type: "image_edit.completed",
				b64_json: "EDIT_FINAL",
				created_at: 1700000001,
				size: "1024x1024",
				usage: { input_tokens: 9, output_tokens: 200 },
			})}`,
			"",
		].join("\n");

		const result = collapseImageGenSse(text);
		expect("json" in result).toBe(true);
		if (!("json" in result)) {
			return;
		}
		expect((result.json.data as any[])[0].b64_json).toBe("EDIT_FINAL");
		expect((result.json.usage as any).output_tokens).toBe(200);
	});

	test("returns json when only a completed event is present (partial_images=0)", () => {
		const text = [
			"event: image_generation.completed",
			`data: ${JSON.stringify({
				type: "image_generation.completed",
				b64_json: "BYTES",
				created_at: 100,
			})}`,
			"",
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("json" in result).toBe(true);
		if (!("json" in result)) {
			return;
		}
		expect((result.json.data as any[])[0].b64_json).toBe("BYTES");
	});

	test("falls back to wall-clock created when created_at missing", () => {
		const text = [
			`data: ${JSON.stringify({
				type: "image_generation.completed",
				b64_json: "BYTES",
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("json" in result).toBe(true);
		if (!("json" in result)) {
			return;
		}
		expect(typeof result.json.created).toBe("number");
		expect(result.json.created).toBeGreaterThan(0);
	});

	test("returns error when no completed event arrives", () => {
		const text = [
			`data: ${JSON.stringify({
				type: "image_generation.partial_image",
				b64_json: "PARTIAL",
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("error" in result).toBe(true);
		if (!("error" in result)) {
			return;
		}
		expect(result.error.code).toBe("incomplete_stream");
	});

	test("returns error when stream contains an error event", () => {
		const text = [
			`data: ${JSON.stringify({
				type: "error",
				message: "Content moderation rejected",
				code: "content_filter",
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("error" in result).toBe(true);
		if (!("error" in result)) {
			return;
		}
		expect(result.error.message).toBe("Content moderation rejected");
		expect(result.error.code).toBe("content_filter");
	});

	test("returns error when error is wrapped in an error object", () => {
		const text = [
			`data: ${JSON.stringify({
				error: {
					message: "Internal failure",
					type: "server_error",
					code: "internal_error",
				},
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("error" in result).toBe(true);
		if (!("error" in result)) {
			return;
		}
		expect(result.error.message).toBe("Internal failure");
		expect(result.error.type).toBe("server_error");
	});

	test("returns error when completed event missing b64_json", () => {
		const text = [
			`data: ${JSON.stringify({
				type: "image_generation.completed",
				created_at: 1,
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("error" in result).toBe(true);
		if (!("error" in result)) {
			return;
		}
		expect(result.error.code).toBe("missing_image");
	});

	test("OpenAI moderation_blocked error event maps to content_filter finish reason", () => {
		const text = [
			`data: ${JSON.stringify({
				error: {
					code: "moderation_blocked",
					message:
						"Your request was rejected by the safety system. If you believe this is an error, contact us at help.openai.com and include the request ID req_abc123.",
					type: "image_generation_user_error",
				},
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("error" in result).toBe(true);
		if (!("error" in result)) {
			return;
		}
		expect(result.error.code).toBe("moderation_blocked");
		expect(getFinishReasonFromError(200, JSON.stringify(result.error))).toBe(
			"content_filter",
		);
	});

	test("ignores [DONE] sentinel and unparseable lines", () => {
		const text = [
			"data: not-json",
			"data: [DONE]",
			`data: ${JSON.stringify({
				type: "image_generation.completed",
				b64_json: "OK",
				created_at: 5,
			})}`,
		].join("\n");
		const result = collapseImageGenSse(text);
		expect("json" in result).toBe(true);
		if (!("json" in result)) {
			return;
		}
		expect((result.json.data as any[])[0].b64_json).toBe("OK");
	});
});
