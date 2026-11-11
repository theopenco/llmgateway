import { describe, expect, it } from "vitest";

import { isLoungeChatModel } from "./model-utils";

const past = new Date("2020-01-01");
const streams = { providerId: "one", streaming: true };
const streamOnly = { providerId: "two", streaming: "only" as const };
const noStream = { providerId: "three", streaming: false };

const realtime = { providerId: "four", streaming: true, realtime: true };
const transcribes = {
	providerId: "five",
	streaming: true,
	realtimeTranscription: true,
};

// Lounge chat always streams, and the gateway only checks the provider it picks.
describe("isLoungeChatModel streaming rule", () => {
	it("accepts a model whose live mappings all stream", () => {
		const providers = [streams, streamOnly];

		expect(isLoungeChatModel({ id: "chat", providers }, providers)).toBe(true);
	});

	it("rejects a model whose only live mapping cannot stream", () => {
		const providers = [noStream];

		expect(isLoungeChatModel({ id: "batch", providers }, providers)).toBe(
			false,
		);
	});

	it("rejects when another provider's live mapping cannot stream", () => {
		const providers = [streams, noStream];

		expect(isLoungeChatModel({ id: "mixed", providers }, [streams])).toBe(
			false,
		);
	});

	it("ignores a deactivated mapping that cannot stream", () => {
		const providers = [streams, { ...noStream, deactivatedAt: past }];

		expect(isLoungeChatModel({ id: "moved", providers }, providers)).toBe(true);
	});
});

describe("isLoungeChatModel realtime rule", () => {
	it("rejects a model with a live realtime mapping", () => {
		const providers = [streams, realtime];

		expect(isLoungeChatModel({ id: "voice", providers }, [streams])).toBe(
			false,
		);
	});

	it("rejects a model with a live realtime transcription mapping", () => {
		const providers = [streams, transcribes];

		expect(isLoungeChatModel({ id: "scribe", providers }, [streams])).toBe(
			false,
		);
	});

	it("ignores deactivated realtime mappings", () => {
		const providers = [
			streams,
			{ ...realtime, deactivatedAt: past },
			{ ...transcribes, deactivatedAt: past },
		];

		expect(isLoungeChatModel({ id: "retired", providers }, providers)).toBe(
			true,
		);
	});
});
