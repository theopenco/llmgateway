import { describe, expect, it } from "vitest";

import { models } from "./models.js";
import { getBatchEndpoints, isLiveMapping } from "./providers.js";

import type { ModelDefinition, ProviderModelMapping } from "./models.js";

const now = new Date();
const entries = (models as readonly ModelDefinition[]).flatMap((model) =>
	model.providers.map((mapping) => ({
		model,
		mapping: mapping as ProviderModelMapping,
	})),
);

function find(
	predicate: (entry: (typeof entries)[number]) => boolean,
): (typeof entries)[number] {
	const entry = entries.find(
		(candidate) =>
			isLiveMapping(candidate.mapping, now) && predicate(candidate),
	);
	if (!entry) {
		throw new Error("no catalogue entry matches the predicate");
	}
	return entry;
}

function isPlainChat({ model, mapping }: (typeof entries)[number]): boolean {
	return (
		(model.output === undefined || model.output.includes("text")) &&
		!mapping.realtime &&
		!mapping.realtimeTranscription &&
		mapping.streaming !== "only"
	);
}

describe("getBatchEndpoints", () => {
	it("offers chat completions and responses for a default-output chat model", () => {
		const { model, mapping } = find(
			(entry) => entry.model.output === undefined && isPlainChat(entry),
		);
		expect(getBatchEndpoints(mapping, model, now)).toEqual([
			"/v1/chat/completions",
			"/v1/responses",
		]);
	});

	it("offers responses for chat models without native Responses API support", () => {
		const { model, mapping } = find(
			(entry) =>
				isPlainChat(entry) && entry.mapping.supportsResponsesApi !== true,
		);
		expect(getBatchEndpoints(mapping, model, now)).toContain("/v1/responses");
	});

	it("treats text-and-image output models as chat models", () => {
		const { model, mapping } = find(
			(entry) =>
				!!entry.model.output?.includes("text") &&
				entry.model.output.includes("image") &&
				isPlainChat(entry),
		);
		expect(getBatchEndpoints(mapping, model, now)).toEqual([
			"/v1/chat/completions",
			"/v1/responses",
		]);
	});

	it("offers only embeddings for embedding models", () => {
		const { model, mapping } = find(
			(entry) =>
				!!entry.model.output?.includes("embedding") &&
				entry.mapping.embeddings === true,
		);
		expect(getBatchEndpoints(mapping, model, now)).toEqual(["/v1/embeddings"]);
	});

	it("offers nothing for an embedding model without an embeddings mapping", () => {
		const { model, mapping } = find(
			(entry) =>
				!!entry.model.output?.includes("embedding") &&
				entry.mapping.embeddings === true,
		);
		expect(
			getBatchEndpoints({ ...mapping, embeddings: false }, model, now),
		).toEqual([]);
	});

	it.each(["realtime", "realtimeTranscription"] as const)(
		"offers nothing for %s mappings",
		(flag) => {
			const { model, mapping } = find((entry) => entry.mapping[flag] === true);
			expect(getBatchEndpoints(mapping, model, now)).toEqual([]);
		},
	);

	it("offers nothing for streaming-only mappings", () => {
		const { model, mapping } = find(isPlainChat);
		expect(
			getBatchEndpoints({ ...mapping, streaming: "only" }, model, now),
		).toEqual([]);
	});

	it.each([
		"image",
		"video",
		"audio",
		"transcription",
		"rerank",
		"ocr",
		"search",
		"decision",
	] as const)("offers nothing for %s-only output models", (kind) => {
		const { model, mapping } = find(
			(entry) =>
				!!entry.model.output?.includes(kind) &&
				!entry.model.output.includes("text"),
		);
		expect(getBatchEndpoints(mapping, model, now)).toEqual([]);
	});

	it("offers nothing once a mapping is deprecated or deactivated", () => {
		const { model, mapping } = find(isPlainChat);
		const past = new Date(now.getTime() - 1);
		expect(
			getBatchEndpoints({ ...mapping, deprecatedAt: past }, model, now),
		).toEqual([]);
		expect(
			getBatchEndpoints({ ...mapping, deactivatedAt: past }, model, now),
		).toEqual([]);
	});
});
