import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	catalogueTranscriptionDefaults,
	describeTranscriptionPrice,
	resolveCallTranscription,
	transcribesInputNatively,
} from "./realtime-transcription";

import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

function realtimeMapping(
	providerId: string,
	inputAudioHourPrice: string | null = null,
) {
	return { providerId, inputAudioHourPrice } as ApiModelProviderMapping;
}

const openaiRealtime = realtimeMapping("openai");
const xaiRealtime = realtimeMapping("xai", "4.80");
const geminiRealtime = realtimeMapping("google-ai-studio");

const transcriptionModels = [
	{
		id: "gpt-live-transcribe",
		name: "GPT Live Transcribe",
		mappings: [
			{
				realtimeTranscription: true,
				providerId: "openai",
				inputAudioHourPrice: "1.02",
				inputAudioPrice: null,
			},
		],
	},
	{
		id: "acme-transcribe",
		name: "Acme Transcribe",
		mappings: [
			{
				realtimeTranscription: true,
				providerId: "acme",
				inputAudioHourPrice: null,
				inputAudioPrice: "1e-6",
			},
		],
	},
	{
		id: "gemini-transcribe",
		name: "Gemini Transcribe",
		mappings: [
			{
				realtimeTranscription: true,
				providerId: "google-ai-studio",
				inputAudioHourPrice: null,
				inputAudioPrice: "1e-6",
			},
		],
	},
	{
		id: "gpt-4o-mini-transcribe",
		name: "GPT-4o Mini Transcribe",
		mappings: [
			{
				realtimeTranscription: true,
				providerId: "openai",
				inputAudioHourPrice: null,
				inputAudioPrice: "3e-6",
			},
		],
	},
	{
		id: "gpt-chat",
		name: "GPT Chat",
		mappings: [
			{
				realtimeTranscription: null,
				providerId: "openai",
				inputAudioHourPrice: null,
				inputAudioPrice: "3e-6",
			},
		],
	},
	{
		id: "gpt-unpriced-transcribe",
		name: null,
		mappings: [
			{
				realtimeTranscription: true,
				providerId: "openai",
				inputAudioHourPrice: null,
				inputAudioPrice: null,
			},
		],
	},
] as unknown as ApiModel[];

const catalogueDefaults = { openai: "openai/gpt-4o-mini-transcribe" };

describe("transcribesInputNatively", () => {
	it("treats Gemini Live as native", () => {
		expect(transcribesInputNatively(geminiRealtime)).toBe(true);
	});

	it("treats a duration-billed realtime mapping as native", () => {
		expect(transcribesInputNatively(xaiRealtime)).toBe(true);
	});

	it("needs an ASR model for a token-billed mapping, from the API or the catalogue", () => {
		expect(transcribesInputNatively(openaiRealtime)).toBe(false);
		expect(transcribesInputNatively({ providerId: "openai" })).toBe(false);
	});
});

describe("resolveCallTranscription", () => {
	const resolve = (
		mapping: ApiModelProviderMapping,
		preferred: string | null = null,
		defaults: Record<string, string> = catalogueDefaults,
	) =>
		resolveCallTranscription({
			realtimeMapping: mapping,
			transcriptionModels,
			preferred,
			catalogueDefaults: defaults,
		});

	it("is native for Gemini even when Gemini has an ASR mapping", () => {
		expect(resolve(geminiRealtime)).toEqual({ kind: "native" });
	});

	it("is native for xAI Grok Voice", () => {
		expect(resolve(xaiRealtime)).toEqual({ kind: "native" });
	});

	it("offers only the realtime provider's transcription mappings, provider-pinned, with name and price", () => {
		const transcription = resolve(openaiRealtime);
		if (transcription.kind !== "asr") {
			throw new Error(`expected asr, got ${transcription.kind}`);
		}
		expect(transcription.options).toEqual([
			{
				model: "openai/gpt-live-transcribe",
				label: "GPT Live Transcribe",
				priceLabel: "$0.017/min",
			},
			{
				model: "openai/gpt-4o-mini-transcribe",
				label: "GPT-4o Mini Transcribe",
				priceLabel: "$3.00/M audio tokens",
			},
			{
				model: "openai/gpt-unpriced-transcribe",
				label: "gpt-unpriced-transcribe",
				priceLabel: null,
			},
		]);
	});

	it("selects the stored preference when it is offered", () => {
		const transcription = resolve(
			openaiRealtime,
			"openai/gpt-unpriced-transcribe",
		);
		expect(transcription.kind === "asr" && transcription.selected.model).toBe(
			"openai/gpt-unpriced-transcribe",
		);
	});

	it.each(["acme/acme-transcribe", "openai/retired-transcribe"])(
		"ignores the unoffered preference %s and selects the catalogue default",
		(preferred) => {
			const transcription = resolve(openaiRealtime, preferred);
			expect(transcription.kind === "asr" && transcription.selected.model).toBe(
				"openai/gpt-4o-mini-transcribe",
			);
		},
	);

	it("selects the first option when the catalogue default is not offered", () => {
		const transcription = resolve(openaiRealtime, null, {
			openai: "openai/retired-transcribe",
		});
		expect(transcription.kind === "asr" && transcription.selected.model).toBe(
			"openai/gpt-live-transcribe",
		);
	});

	it("is unavailable for a token-billed provider with no ASR model", () => {
		expect(resolve(realtimeMapping("nova"))).toEqual({ kind: "unavailable" });
	});
});

describe("catalogueTranscriptionDefaults", () => {
	it("picks the first ASR mapping in definition order, not the newest release", () => {
		const definitions = [
			{
				id: "first-asr",
				releasedAt: new Date("2025-01-01"),
				providers: [{ providerId: "openai", realtimeTranscription: true }],
			},
			{
				id: "newer-asr",
				releasedAt: new Date("2026-01-01"),
				providers: [{ providerId: "openai", realtimeTranscription: true }],
			},
		] as const;
		expect(catalogueTranscriptionDefaults(definitions, new Date())).toEqual({
			openai: "openai/first-asr",
		});
	});

	it("skips non-ASR and deactivated mappings and keys one default per provider", () => {
		const definitions = [
			{
				id: "retired-asr",
				providers: [
					{
						providerId: "openai",
						realtimeTranscription: true,
						deactivatedAt: new Date("2026-01-01"),
					},
				],
			},
			{ id: "chat-model", providers: [{ providerId: "openai" }] },
			{
				id: "live-asr",
				providers: [{ providerId: "openai", realtimeTranscription: true }],
			},
			{
				id: "sunsetting-asr",
				providers: [
					{
						providerId: "xai",
						realtimeTranscription: true,
						deactivatedAt: new Date("2027-01-01"),
					},
				],
			},
			{
				id: "later-asr",
				providers: [
					{ providerId: "openai", realtimeTranscription: true },
					{ providerId: "xai", realtimeTranscription: true },
				],
			},
		] as const;
		expect(
			catalogueTranscriptionDefaults(definitions, new Date("2026-06-01")),
		).toEqual({
			openai: "openai/live-asr",
			xai: "xai/sunsetting-asr",
		});
	});
});

describe("realtime catalogue", () => {
	const now = new Date();
	const defaults = catalogueTranscriptionDefaults(models, now);
	const activeRealtime = (models as readonly ModelDefinition[]).flatMap(
		(model) =>
			(model.providers as readonly ProviderModelMapping[])
				.filter(
					(mapping) =>
						mapping.realtime === true &&
						!(mapping.deactivatedAt && now > mapping.deactivatedAt),
				)
				.map(
					(mapping) => [`${mapping.providerId}/${model.id}`, mapping] as const,
				),
	);

	it("has active realtime mappings", () => {
		expect(activeRealtime.length).toBeGreaterThan(0);
	});

	it.each(activeRealtime)(
		"%s transcribes natively or has a default ASR model on its provider",
		(_id, mapping) => {
			expect(
				transcribesInputNatively(mapping) ||
					defaults[mapping.providerId] !== undefined,
			).toBe(true);
		},
	);
});

describe("describeTranscriptionPrice", () => {
	it("prices an hour-billed mapping per minute", () => {
		expect(
			describeTranscriptionPrice({
				inputAudioHourPrice: "0.27",
				inputAudioPrice: null,
			} as ApiModelProviderMapping),
		).toBe("$0.005/min");
	});

	it("prices a token-billed mapping per million audio tokens", () => {
		expect(
			describeTranscriptionPrice({
				inputAudioHourPrice: null,
				inputAudioPrice: "6e-6",
			} as ApiModelProviderMapping),
		).toBe("$6.00/M audio tokens");
	});

	it("returns null without a positive price or a mapping", () => {
		expect(
			describeTranscriptionPrice({
				inputAudioHourPrice: "0",
				inputAudioPrice: null,
			} as ApiModelProviderMapping),
		).toBeNull();
		expect(describeTranscriptionPrice(null)).toBeNull();
	});
});
