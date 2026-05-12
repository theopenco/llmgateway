import { describe, expect, it } from "vitest";

import {
	googleProviderSupportsAudioFormat,
	transformGoogleMessages,
	UnsupportedAudioFormatError,
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
