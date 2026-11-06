import { gatewayClient } from "@/api/gateway";
import { config } from "@/config";

import { models as catalogue } from "@llmgateway/models";

import type { CatalogModel } from "@/components/ProviderOptions";
import type { paths } from "@/lib/api/gateway";
import type { ProviderModelMapping } from "@llmgateway/models";

type SessionRequest = NonNullable<
	paths["/v1/realtime/client_secrets"]["post"]["requestBody"]
>["content"]["application/json"]["session"];

async function mintSession(
	projectId: string,
	model: string,
	session: SessionRequest,
	signal: AbortSignal,
) {
	const gateway = await gatewayClient(projectId, model);
	signal.throwIfAborted();
	const { data } = await gateway.POST("/v1/realtime/client_secrets", {
		signal,
		body: { expires_after: { anchor: "created_at", seconds: 60 }, session },
	});
	if (!data?.value || data.session.type !== session.type) {
		throw new Error(`The gateway did not create a ${session.type} session.`);
	}
	return {
		secret: data.value,
		model:
			data.session.type === "transcription"
				? data.session.audio.input.transcription.model
				: data.session.model,
		url: `${config.gatewayUrl.replace(/\/v1\/?$/, "").replace(/^http/, "ws")}/v1/realtime?${session.type === "transcription" ? "intent=transcription&" : ""}model=${encodeURIComponent(model)}`,
	};
}

export function mintTranscriptionSession(
	projectId: string,
	model: string,
	signal: AbortSignal,
) {
	return mintSession(
		projectId,
		model,
		{ type: "transcription", audio: { input: { transcription: { model } } } },
		signal,
	);
}

export interface VoiceSelection {
	model: string;
	voice: string | null;
	protocol: "openai" | "gemini";
	transcriptionModel?: string;
}
export function findVoiceModel(selection: string, models: CatalogModel[]) {
	for (const model of models) {
		if (model.status !== "active") {
			continue;
		}
		for (const mapping of model.mappings) {
			if (
				!mapping.realtime ||
				mapping.status !== "active" ||
				(mapping.deactivatedAt &&
					new Date(mapping.deactivatedAt).getTime() <= Date.now())
			) {
				continue;
			}
			const id = `${mapping.providerId}/${model.id}${mapping.region ? `:${mapping.region}` : ""}`;
			if (selection === id || selection === model.id) {
				return { model, mapping, id };
			}
		}
	}
	return undefined;
}
export interface TranscriptionOption {
	model: string;
	label: string;
	price: string | null;
}
function transcriptionPrice(mapping: CatalogModel["mappings"][number]) {
	const hour = mapping.inputAudioHourPrice
		? parseFloat(mapping.inputAudioHourPrice)
		: 0;
	if (hour > 0) {
		return `$${(hour / 60).toFixed(3)}/min`;
	}
	const token = mapping.inputAudioPrice
		? parseFloat(mapping.inputAudioPrice)
		: 0;
	return token > 0 ? `$${(token * 1_000_000).toFixed(2)}/M audio tokens` : null;
}
export function transcriptionOptions(
	model: string,
	models: CatalogModel[],
): TranscriptionOption[] {
	const resolved = findVoiceModel(model, models);
	if (
		!resolved ||
		resolved.mapping.providerId === "google-ai-studio" ||
		typeof resolved.mapping.inputAudioHourPrice === "string"
	) {
		return [];
	}
	const provider = resolved.mapping.providerId;
	return models.flatMap((candidate) => {
		if (candidate.status !== "active") {
			return [];
		}
		const mapping = candidate.mappings.find(
			(entry) =>
				entry.providerId === provider &&
				entry.status === "active" &&
				entry.realtimeTranscription &&
				(!entry.deactivatedAt ||
					new Date(entry.deactivatedAt).getTime() > Date.now()),
		);
		return mapping
			? [
					{
						model: `${provider}/${candidate.id}${mapping.region ? `:${mapping.region}` : ""}`,
						label: candidate.name ?? candidate.id,
						price: transcriptionPrice(mapping),
					},
				]
			: [];
	});
}
function catalogueTranscriptionDefault(provider: string) {
	const now = new Date();
	const model = catalogue.find((definition) =>
		(definition.providers as readonly ProviderModelMapping[]).some(
			(mapping) =>
				mapping.providerId === provider &&
				mapping.realtimeTranscription === true &&
				(!mapping.deactivatedAt || mapping.deactivatedAt > now),
		),
	);
	return model ? `${provider}/${model.id}` : undefined;
}
export function chooseTranscription(
	options: TranscriptionOption[],
	preferred?: string | null,
) {
	const provider = options[0]?.model.split("/")[0];
	const fallback = provider && catalogueTranscriptionDefault(provider);
	return (
		options.find((option) => option.model === preferred) ??
		options.find(
			(option) =>
				option.model === fallback || option.model.startsWith(`${fallback}:`),
		) ??
		options[0]
	);
}
export function voiceSelection(
	model: string,
	voice: string | null,
	models: CatalogModel[],
	preferredTranscription?: string | null,
): VoiceSelection {
	const resolved = findVoiceModel(model, models);
	if (!resolved) {
		throw new Error("Choose an available realtime model before calling.");
	}
	const protocol =
		resolved.mapping.providerId === "google-ai-studio" ? "gemini" : "openai";
	const options = transcriptionOptions(resolved.id, models);
	const native =
		protocol === "gemini" ||
		typeof resolved.mapping.inputAudioHourPrice === "string";
	if (!native && !options.length) {
		throw new Error(
			"This provider has no active transcription model, so calls can't start.",
		);
	}
	const transcriptionModel = native
		? undefined
		: chooseTranscription(options, preferredTranscription)?.model;
	return { model: resolved.id, voice, protocol, transcriptionModel };
}
export function mintVoiceSession(
	projectId: string,
	selection: VoiceSelection,
	signal: AbortSignal,
) {
	return mintSession(
		projectId,
		selection.model,
		{
			type: "realtime",
			model: selection.model,
			audio: {
				...(selection.transcriptionModel
					? {
							input: { transcription: { model: selection.transcriptionModel } },
						}
					: {}),
				...(selection.voice ? { output: { voice: selection.voice } } : {}),
			},
		},
		signal,
	);
}
