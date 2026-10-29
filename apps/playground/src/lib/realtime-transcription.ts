import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";
import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export const GEMINI_PROVIDER_ID = "google-ai-studio";

export interface CallTranscriptionOption {
	model: string;
	label: string;
	priceLabel: string | null;
}

export type CallTranscription =
	| { kind: "native" }
	| {
			kind: "asr";
			options: CallTranscriptionOption[];
			selected: CallTranscriptionOption;
	  }
	| { kind: "unavailable" };

/**
 * Mirrors the gateway: Gemini Live transcribes in its own protocol, and a
 * duration-billed session (`isDurationBilledRealtime`) forwards upstream
 * transcripts as part of its price.
 */
export function transcribesInputNatively(mapping: {
	providerId: string;
	inputAudioHourPrice?: string | null;
}): boolean {
	return (
		mapping.providerId === GEMINI_PROVIDER_ID ||
		typeof mapping.inputAudioHourPrice === "string"
	);
}

export interface ResolveCallTranscriptionInput {
	realtimeMapping: ApiModelProviderMapping;
	transcriptionModels: ApiModel[];
	preferred: string | null;
	catalogueDefaults: Record<string, string>;
}

export function resolveCallTranscription({
	realtimeMapping,
	transcriptionModels,
	preferred,
	catalogueDefaults,
}: ResolveCallTranscriptionInput): CallTranscription {
	if (transcribesInputNatively(realtimeMapping)) {
		return { kind: "native" };
	}
	const { providerId } = realtimeMapping;
	// The gateway runs the ASR model inside the realtime provider's session.
	const options = transcriptionModels.flatMap((model) => {
		const mapping = model.mappings.find(
			(m) => m.providerId === providerId && m.realtimeTranscription === true,
		);
		return mapping
			? [
					{
						model: `${providerId}/${model.id}`,
						label: model.name ?? model.id,
						priceLabel: describeTranscriptionPrice(mapping),
					},
				]
			: [];
	});
	const [first] = options;
	if (!first) {
		return { kind: "unavailable" };
	}
	const offered = (model: string | null | undefined) =>
		options.find((option) => option.model === model);
	return {
		kind: "asr",
		options,
		selected:
			offered(preferred) ?? offered(catalogueDefaults[providerId]) ?? first,
	};
}

/**
 * Computed on the server: the Models API orders by creation date, so the
 * browser cannot recover catalogue definition order.
 */
export function catalogueTranscriptionDefaults(
	definitions: readonly (Pick<ModelDefinition, "id"> & {
		providers: readonly Pick<
			ProviderModelMapping,
			"providerId" | "realtimeTranscription" | "deactivatedAt"
		>[];
	})[],
	now: Date,
): Record<string, string> {
	const defaults: Record<string, string> = {};
	for (const model of definitions) {
		for (const mapping of model.providers) {
			if (mapping.realtimeTranscription !== true) {
				continue;
			}
			if (mapping.deactivatedAt && now > mapping.deactivatedAt) {
				continue;
			}
			defaults[mapping.providerId] ??= `${mapping.providerId}/${model.id}`;
		}
	}
	return defaults;
}

export function describeTranscriptionPrice(
	mapping: ApiModelProviderMapping | null,
): string | null {
	if (!mapping) {
		return null;
	}
	const hourPrice = mapping.inputAudioHourPrice
		? parseFloat(mapping.inputAudioHourPrice)
		: 0;
	if (hourPrice > 0) {
		return `$${(hourPrice / 60).toFixed(3)}/min`;
	}
	const audioTokenPrice = mapping.inputAudioPrice
		? parseFloat(mapping.inputAudioPrice)
		: 0;
	if (audioTokenPrice > 0) {
		return `$${(audioTokenPrice * 1_000_000).toFixed(2)}/M audio tokens`;
	}
	return null;
}
