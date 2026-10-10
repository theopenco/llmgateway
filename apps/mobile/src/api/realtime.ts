import { gatewayClient } from "@/api/gateway";
import { config } from "@/config";

import type { CatalogModel } from "@/components/ProviderOptions";
import type { paths } from "@/lib/api/gateway";

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
export function voiceSelection(
	model: string,
	voice: string | null,
	models: CatalogModel[],
): VoiceSelection {
	const resolved = findVoiceModel(model, models);
	if (!resolved) {
		throw new Error("Choose an available realtime model before calling.");
	}
	model = resolved.id;
	const provider = resolved.mapping.providerId;
	const protocol = provider === "google-ai-studio" ? "gemini" : "openai";
	let transcriptionModel: string | undefined;
	if (protocol === "openai") {
		for (const candidate of models) {
			if (candidate.status !== "active") {
				continue;
			}
			const mapping = candidate.mappings.find(
				(entry) =>
					entry.providerId === provider &&
					entry.status === "active" &&
					entry.realtimeTranscription &&
					(!entry.deactivatedAt ||
						new Date(entry.deactivatedAt).getTime() > Date.now()),
			);
			if (mapping) {
				transcriptionModel = `${provider}/${candidate.id}${mapping.region ? `:${mapping.region}` : ""}`;
				break;
			}
		}
	}
	return { model, voice, protocol, transcriptionModel };
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
