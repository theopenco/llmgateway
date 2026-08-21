import { describe, expect, it } from "vitest";

import { RequestError } from "./request-error.js";
import {
	googleProviderSupportsAudioFormat,
	parseGoogleUpstreamDocumentError,
	transformGoogleMessages,
	UnsupportedAudioFormatError,
	UnsupportedDocumentFormatError,
} from "./transform-google-messages.js";

import type { BaseMessage } from "@llmgateway/models";

type AudioFormat =
	| "wav"
	| "mp3"
	| "aiff"
	| "aac"
	| "ogg"
	| "flac"
	| "m4a"
	| "mpeg"
	| "mpga"
	| "mp4"
	| "pcm"
	| "webm";

function audioMessages(format: AudioFormat): BaseMessage[] {
	return [
		{
			role: "user",
			content: [
				{
					type: "input_audio",
					input_audio: {
						data: "AAAA",
						format,
					},
				},
			],
		},
	];
}

describe("transformGoogleMessages — audio MIME resolution", () => {
	it("maps AI Studio formats including aiff", async () => {
		const out = await transformGoogleMessages(
			audioMessages("aiff"),
			false,
			20,
			null,
			undefined,
			"google-ai-studio",
		);
		expect(out[0].parts[0].inline_data?.mime_type).toBe("audio/aiff");
	});

	it("maps Vertex aac to audio/x-aac (not audio/aac)", async () => {
		const out = await transformGoogleMessages(
			audioMessages("aac"),
			false,
			20,
			null,
			undefined,
			"google-vertex",
		);
		expect(out[0].parts[0].inline_data?.mime_type).toBe("audio/x-aac");
	});

	it("maps Vertex m4a (a Vertex-only extension)", async () => {
		const out = await transformGoogleMessages(
			audioMessages("m4a"),
			false,
			20,
			null,
			undefined,
			"google-vertex",
		);
		expect(out[0].parts[0].inline_data?.mime_type).toBe("audio/m4a");
	});

	it("throws UnsupportedAudioFormatError for Vertex + aiff", async () => {
		await expect(
			transformGoogleMessages(
				audioMessages("aiff"),
				false,
				20,
				null,
				undefined,
				"google-vertex",
			),
		).rejects.toBeInstanceOf(UnsupportedAudioFormatError);
	});

	it("throws UnsupportedAudioFormatError for AI Studio + m4a", async () => {
		await expect(
			transformGoogleMessages(
				audioMessages("m4a"),
				false,
				20,
				null,
				undefined,
				"google-ai-studio",
			),
		).rejects.toBeInstanceOf(UnsupportedAudioFormatError);
	});

	it("attaches format and providerTarget on the error", async () => {
		try {
			await transformGoogleMessages(
				audioMessages("aiff"),
				false,
				20,
				null,
				undefined,
				"quartz",
			);
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(UnsupportedAudioFormatError);
			const e = err as UnsupportedAudioFormatError;
			expect(e.format).toBe("aiff");
			expect(e.providerTarget).toBe("Vertex AI");
		}
	});
});

describe("transformGoogleMessages — image URL processing errors", () => {
	it("throws RequestError (400) for a non-HTTPS image URL in production", async () => {
		const messages: BaseMessage[] = [
			{
				role: "user",
				content: [
					{
						type: "image_url",
						image_url: { url: "http://example.com/image.png" },
					},
				],
			},
		];
		try {
			await transformGoogleMessages(messages, true);
			throw new Error("expected throw");
		} catch (err) {
			expect(err).toBeInstanceOf(RequestError);
			const e = err as RequestError;
			expect(e.statusCode).toBe(400);
			expect(e.message).toBe(
				"Failed to process image: Image URLs must use HTTPS protocol in production",
			);
		}
	});
});

describe("googleProviderSupportsAudioFormat", () => {
	it("AI Studio accepts wav/mp3/aiff/aac/ogg/flac", () => {
		const fmts = ["wav", "mp3", "aiff", "aac", "ogg", "flac"];
		for (const f of fmts) {
			expect(googleProviderSupportsAudioFormat("google-ai-studio", f)).toBe(
				true,
			);
		}
	});

	it("AI Studio rejects vertex-only formats", () => {
		const fmts = ["m4a", "mpeg", "mpga", "mp4", "pcm", "webm"];
		for (const f of fmts) {
			expect(googleProviderSupportsAudioFormat("google-ai-studio", f)).toBe(
				false,
			);
		}
	});

	it("Vertex accepts m4a/mp4/pcm/webm/mpeg/mpga + shared formats", () => {
		const fmts = [
			"wav",
			"mp3",
			"aac",
			"ogg",
			"flac",
			"m4a",
			"mpeg",
			"mpga",
			"mp4",
			"pcm",
			"webm",
		];
		for (const f of fmts) {
			expect(googleProviderSupportsAudioFormat("google-vertex", f)).toBe(true);
		}
	});

	it("Vertex rejects aiff (AI-Studio-only)", () => {
		expect(googleProviderSupportsAudioFormat("google-vertex", "aiff")).toBe(
			false,
		);
		expect(googleProviderSupportsAudioFormat("quartz", "aiff")).toBe(false);
	});

	it("returns true for non-Google providers (defers to provider.audio)", () => {
		expect(googleProviderSupportsAudioFormat("openai", "m4a")).toBe(true);
		expect(googleProviderSupportsAudioFormat(undefined, "wav")).toBe(true);
	});
});

function fileMessage(mime: string, data = "ZHVtbXk="): BaseMessage[] {
	return [
		{
			role: "user",
			content: [
				{ type: "text", text: "summarize" },
				{
					type: "file",
					file: {
						filename: "doc",
						file_data: `data:${mime};base64,${data}`,
					},
				},
			],
		},
	];
}

describe("transformGoogleMessages — document file blocks", () => {
	it("passes the supplied MIME through to inline_data verbatim", async () => {
		const out = await transformGoogleMessages(
			fileMessage("application/pdf"),
			false,
			20,
			null,
			undefined,
			"google-ai-studio",
		);
		const filePart = out[0].parts.find((p) => p.inline_data);
		expect(filePart?.inline_data?.mime_type).toBe("application/pdf");
		expect(filePart?.inline_data?.data).toBe("ZHVtbXk=");
	});

	it("does not pre-validate MIMEs — Google's API is authoritative", async () => {
		// Pass a MIME Gemini would reject (.docx). The transform still builds the
		// request body; the upstream call rejects, and parseGoogleUpstreamDocumentError
		// re-emits the typed error from Google's response.
		const out = await transformGoogleMessages(
			fileMessage(
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			),
			false,
			20,
			null,
			undefined,
			"google-ai-studio",
		);
		const filePart = out[0].parts.find((p) => p.inline_data);
		expect(filePart?.inline_data?.mime_type).toBe(
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		);
	});

	it("preserves a mixed-case mime verbatim", async () => {
		const out = await transformGoogleMessages(
			fileMessage("Application/PDF"),
			false,
			20,
			null,
			undefined,
			"google-ai-studio",
		);
		const filePart = out[0].parts.find((p) => p.inline_data);
		expect(filePart?.inline_data?.mime_type).toBe("Application/PDF");
	});

	it("accepts RFC 2397 MIME parameters and strips them", async () => {
		const out = await transformGoogleMessages(
			[
				{
					role: "user",
					content: [
						{
							type: "file",
							file: {
								filename: "doc",
								file_data: "data:text/plain;charset=utf-8;base64,SGVsbG8=",
							},
						},
					],
				},
			],
			false,
			20,
			null,
			undefined,
			"google-ai-studio",
		);
		const filePart = out[0].parts.find((p) => p.inline_data);
		expect(filePart?.inline_data?.mime_type).toBe("text/plain");
		expect(filePart?.inline_data?.data).toBe("SGVsbG8=");
	});

	it("throws a non-typed Error when file_data isn't a base64 data URL", async () => {
		await expect(
			transformGoogleMessages(
				[
					{
						role: "user",
						content: [
							{
								type: "file",
								file: { filename: "x", file_data: "not-a-data-url" },
							},
						],
					},
				],
				false,
				20,
				null,
				undefined,
				"google-ai-studio",
			),
		).rejects.toThrow(/data URL/);
	});

	it("throws a non-typed Error when only file_id is provided", async () => {
		await expect(
			transformGoogleMessages(
				[
					{
						role: "user",
						content: [{ type: "file", file: { file_id: "file-abc123" } }],
					},
				],
				false,
				20,
				null,
				undefined,
				"google-ai-studio",
			),
		).rejects.toThrow(/file_data/);
	});

	it("transforms a large base64 document in ~constant time", async () => {
		const tiny = "data:application/pdf;base64,QQ==";
		const big = "data:application/pdf;base64," + "A".repeat(12 * 1024 * 1024); // 12 MB

		async function timeTransform(
			fileData: string,
			iterations: number,
		): Promise<number> {
			const messages: BaseMessage[] = [
				{
					role: "user",
					content: [
						{
							type: "file",
							file: { filename: "doc.pdf", file_data: fileData },
						},
					],
				},
			];
			await transformGoogleMessages(
				messages,
				false,
				20,
				null,
				undefined,
				"google-ai-studio",
			); // warm up
			const start = performance.now();
			for (let i = 0; i < iterations; i++) {
				await transformGoogleMessages(
					messages,
					false,
					20,
					null,
					undefined,
					"google-ai-studio",
				);
			}
			return performance.now() - start;
		}

		const iterations = 50;
		const tinyMs = await timeTransform(tiny, iterations);
		const bigMs = await timeTransform(big, iterations);

		// parseFileDataUrl never scans the base64 body, so a 12MB document costs
		// ~the same as a 4-byte one. A `^data:...,(.*)$` regex would scan + copy
		// 12MB per call (~3ms), blowing past this bound. The size-ratio check is
		// CPU-speed independent; the +100ms slack absorbs CI noise.
		const scaled = tinyMs * 10;
		const bound = scaled + 100;
		expect(bigMs).toBeLessThan(bound);

		// Sanity: the payload is forwarded intact, not truncated.
		const out = await transformGoogleMessages(
			[
				{
					role: "user",
					content: [
						{ type: "file", file: { filename: "doc.pdf", file_data: big } },
					],
				},
			],
			false,
			20,
			null,
			undefined,
			"google-ai-studio",
		);
		const filePart = out[0].parts.find((p) => p.inline_data);
		expect(filePart?.inline_data?.data.length).toBe(12 * 1024 * 1024);
	});
});

describe("parseGoogleUpstreamDocumentError", () => {
	const aiStudioUnsupportedMime = JSON.stringify({
		error: {
			code: 400,
			status: "INVALID_ARGUMENT",
			message: "Unsupported MIME type: application/msword",
		},
	});

	it("returns a typed UnsupportedDocumentFormatError for the canonical message", () => {
		const result = parseGoogleUpstreamDocumentError(
			aiStudioUnsupportedMime,
			"google-ai-studio",
		);
		expect(result).toBeInstanceOf(UnsupportedDocumentFormatError);
		expect(result?.mimeType).toBe("application/msword");
		expect(result?.providerTarget).toBe("Google AI Studio");
	});

	it("maps Vertex provider to the right target string", () => {
		const result = parseGoogleUpstreamDocumentError(
			aiStudioUnsupportedMime,
			"google-vertex",
		);
		expect(result?.providerTarget).toBe("Vertex AI");
	});

	it("handles a trailing period in Google's message", () => {
		const body = JSON.stringify({
			error: { message: "Unsupported MIME type: application/zip." },
		});
		const result = parseGoogleUpstreamDocumentError(body, "google-ai-studio");
		expect(result?.mimeType).toBe("application/zip");
	});

	it("returns null for unrelated Google errors", () => {
		const body = JSON.stringify({
			error: {
				code: 400,
				status: "INVALID_ARGUMENT",
				message: "Request contains an invalid argument.",
			},
		});
		expect(
			parseGoogleUpstreamDocumentError(body, "google-ai-studio"),
		).toBeNull();
	});

	it("returns null for the RTF 500 case (Google internal error)", () => {
		const body = JSON.stringify({
			error: {
				code: 500,
				status: "INTERNAL",
				message: "An internal error has occurred. Please retry.",
			},
		});
		expect(
			parseGoogleUpstreamDocumentError(body, "google-ai-studio"),
		).toBeNull();
	});

	it("returns null for non-JSON garbage", () => {
		expect(
			parseGoogleUpstreamDocumentError("<html>503</html>", "google-ai-studio"),
		).toBeNull();
		expect(parseGoogleUpstreamDocumentError("", "google-ai-studio")).toBeNull();
	});
});
