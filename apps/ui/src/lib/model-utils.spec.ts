import { describe, expect, it } from "vitest";

import { isLoungeChatModel } from "./model-utils";

const past = new Date("2020-01-01");
const streams = { providerId: "one", streaming: true };
const streamOnly = { providerId: "two", streaming: "only" as const };
const noStream = { providerId: "three", streaming: false };

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
