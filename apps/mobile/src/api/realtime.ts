import { gatewayClient } from "@/api/gateway";
import { config } from "@/config";

export async function mintTranscriptionSession(
	projectId: string,
	model: string,
	signal: AbortSignal,
) {
	const gateway = await gatewayClient(projectId, model);
	signal.throwIfAborted();
	const { data } = await gateway.POST("/v1/realtime/client_secrets", {
		signal,
		body: {
			expires_after: { anchor: "created_at", seconds: 60 },
			session: {
				type: "transcription",
				audio: { input: { transcription: { model } } },
			},
		},
	});
	if (!data?.value || data.session.type !== "transcription") {
		throw new Error("The gateway did not create a transcription session.");
	}
	return {
		secret: data.value,
		model: data.session.audio.input.transcription.model,
		url: `${config.gatewayUrl.replace(/\/v1\/?$/, "").replace(/^http/, "ws")}/v1/realtime?intent=transcription&model=${encodeURIComponent(model)}`,
	};
}
