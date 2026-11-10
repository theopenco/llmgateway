import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
	getApiKeyFingerprint,
	getApiKeyFingerprints,
	getApiKeyHashSecret,
	getApiKeyHashSecrets,
} from "@llmgateway/shared/api-key-hash";
import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";
import {
	decryptProviderKey,
	encryptProviderKey,
} from "@llmgateway/shared/provider-key-crypto";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";
import type { ProviderModelMapping } from "@llmgateway/models";

export const AIRSIDE_INFERENCE_PATH = "/v1/internal/airside/inference";
/** `log.source` of internal Airside inference (verification and benchmark
 *  probes). Client sources never normalize to it, so it marks synthetic traffic. */
export const AIRSIDE_INFERENCE_LOG_SOURCE = "airside";
const PURPOSE = "airside-gateway-inference:v1";
const ENVELOPE_TTL_MS = 300_000;

export interface AirsideInferencePricing extends Pick<
	ProviderModelMapping,
	| "cachedInputPrice"
	| "cacheReadInputPrice"
	| "cacheWriteInputPrice"
	| "cacheWriteInputPrice1h"
	| "requestPrice"
	| "webSearchPrice"
	| "pricingTiers"
	| "peakPricing"
	| "inputAudioPrice"
	| "cachedInputAudioPrice"
	| "imageInputPrice"
	| "cachedImageInputPrice"
	| "imageInputTokensByResolution"
> {
	inputPrice: string;
	outputPrice: string;
}

export interface AirsideGatewayFetchOptions {
	runId: string;
	providerKeyId?: string;
	target: ProviderModelVerificationTarget;
	pricing: AirsideInferencePricing;
	incomingHeaders?: HeadersInit;
	responseFormat?: "openai-chat-completions";
	onInfrastructureError?: (error: AirsideGatewayInfrastructureError) => void;
}

export interface AirsideInferencePayload extends Omit<
	AirsideGatewayFetchOptions,
	"incomingHeaders" | "onInfrastructureError"
> {
	endpoint: string;
	headers: Record<string, string>;
	body: string;
}

export interface AirsideInferenceEnvelope {
	runId: string;
	nonce: string;
	expiresAt: number;
	keyHash: string;
	ciphertext: string;
	signature: string;
}

function signatureInput(
	envelope: Omit<AirsideInferenceEnvelope, "signature">,
): string {
	return JSON.stringify([
		PURPOSE,
		envelope.runId,
		envelope.nonce,
		envelope.expiresAt,
		envelope.keyHash,
		envelope.ciphertext,
	]);
}

export function sealAirsideInference(
	payload: AirsideInferencePayload,
	apiToken: string,
): AirsideInferenceEnvelope {
	const nonce = randomUUID();
	const keyHash = getApiKeyFingerprint(apiToken);
	const unsigned = {
		runId: payload.runId,
		nonce,
		expiresAt: Date.now() + ENVELOPE_TTL_MS,
		keyHash,
		ciphertext: encryptProviderKey(
			JSON.stringify(payload, (key, value: unknown) =>
				key === "upToTokens" && value === Infinity
					? Number.MAX_SAFE_INTEGER
					: value,
			),
			`${PURPOSE}:${payload.runId}:${nonce}`,
			keyHash,
		),
	};
	return {
		...unsigned,
		signature: createHmac("sha256", getApiKeyHashSecret())
			.update(signatureInput(unsigned))
			.digest("hex"),
	};
}

export function openAirsideInference(
	value: unknown,
	apiToken: string,
): { envelope: AirsideInferenceEnvelope; payload: AirsideInferencePayload } {
	try {
		if (!value || typeof value !== "object") {
			throw new Error();
		}
		const envelope = value as AirsideInferenceEnvelope;
		if (
			typeof envelope.runId !== "string" ||
			envelope.runId.length > 200 ||
			!envelope.runId ||
			typeof envelope.nonce !== "string" ||
			!/^[0-9a-f-]{36}$/.test(envelope.nonce) ||
			typeof envelope.expiresAt !== "number" ||
			!Number.isSafeInteger(envelope.expiresAt) ||
			envelope.expiresAt <= Date.now() ||
			envelope.expiresAt > Date.now() + ENVELOPE_TTL_MS + 30_000 ||
			typeof envelope.keyHash !== "string" ||
			!getApiKeyFingerprints(apiToken).includes(envelope.keyHash) ||
			typeof envelope.ciphertext !== "string" ||
			typeof envelope.signature !== "string" ||
			!/^[0-9a-f]{64}$/.test(envelope.signature)
		) {
			throw new Error();
		}
		const valid = getApiKeyHashSecrets().some((secret) =>
			timingSafeEqual(
				Buffer.from(envelope.signature, "hex"),
				createHmac("sha256", secret).update(signatureInput(envelope)).digest(),
			),
		);
		if (!valid) {
			throw new Error();
		}
		const payload = JSON.parse(
			decryptProviderKey(
				envelope.ciphertext,
				`${PURPOSE}:${envelope.runId}:${envelope.nonce}`,
				envelope.keyHash,
			),
		) as AirsideInferencePayload;
		if (payload.runId !== envelope.runId) {
			throw new Error();
		}
		return { envelope, payload };
	} catch {
		throw new Error("Invalid internal inference envelope");
	}
}

/** Server-only transport: no caller-controlled operator key, endpoint override or direct-fetch fallback. */
export function createAirsideGatewayFetch(
	options: AirsideGatewayFetchOptions,
): typeof fetch {
	return async (input, init) => {
		try {
			const apiToken = process.env.AIRSIDE_GATEWAY_API_KEY;
			const gatewayUrl = process.env.GATEWAY_URL;
			if (!apiToken || !gatewayUrl) {
				throw new AirsideGatewayInfrastructureError();
			}
			const url = new URL(gatewayUrl);
			if (
				url.username ||
				url.password ||
				url.search ||
				url.hash ||
				(url.protocol !== "https:" &&
					!(process.env.NODE_ENV !== "production" && url.protocol === "http:"))
			) {
				throw new AirsideGatewayInfrastructureError();
			}
			if (
				input instanceof Request ||
				init?.method !== "POST" ||
				typeof init.body !== "string"
			) {
				throw new AirsideGatewayInfrastructureError();
			}
			JSON.parse(init.body);
			const envelope = sealAirsideInference(
				{
					runId: options.runId,
					providerKeyId: options.providerKeyId,
					target: options.target,
					pricing: options.pricing,
					responseFormat: options.responseFormat,
					endpoint: String(input),
					headers: Object.fromEntries(new Headers(init.headers)),
					body: init.body,
				},
				apiToken,
			);
			const response = await fetch(new URL(AIRSIDE_INFERENCE_PATH, url), {
				method: "POST",
				redirect: "error",
				headers: {
					Authorization: `Bearer ${apiToken}`,
					"Content-Type": "application/json",
					...forwardedIpHeaders(new Headers(options.incomingHeaders)),
				},
				body: JSON.stringify(envelope),
				signal: init.signal,
			});
			if (!validAirsideInferenceResponse(response, envelope)) {
				await response.body?.cancel();
				throw new AirsideGatewayInfrastructureError();
			}
			return monitorAirsideInferenceStream(
				response,
				envelope,
				options,
				init.signal,
			);
		} catch {
			const error = new AirsideGatewayInfrastructureError();
			options.onInfrastructureError?.(error);
			throw error;
		}
	};
}
export class AirsideGatewayInfrastructureError extends Error {
	public constructor() {
		super("Airside gateway inference is unavailable");
		this.name = "AirsideGatewayInfrastructureError";
	}
}
export function signAirsideInferenceResponse(
	envelope: AirsideInferenceEnvelope,
	status: number,
): string {
	const secret = getApiKeyHashSecrets().find((candidate) =>
		timingSafeEqual(
			Buffer.from(envelope.signature, "hex"),
			createHmac("sha256", candidate).update(signatureInput(envelope)).digest(),
		),
	);
	if (!secret) {
		throw new Error("Invalid internal inference envelope");
	}
	return createHmac("sha256", secret)
		.update(`${PURPOSE}:response:${envelope.signature}:${status}`)
		.digest("hex");
}
function validAirsideInferenceResponse(
	response: Response,
	envelope: AirsideInferenceEnvelope,
): boolean {
	return validAirsideInferenceSignature(
		response.headers.get("x-airside-inference"),
		envelope,
		response.status,
	);
}
function validAirsideInferenceSignature(
	signature: string | null,
	envelope: AirsideInferenceEnvelope,
	status: number,
): boolean {
	if (!signature || !/^[0-9a-f]{64}$/.test(signature)) {
		return false;
	}
	return getApiKeyHashSecrets().some((secret) =>
		timingSafeEqual(
			Buffer.from(signature, "hex"),
			createHmac("sha256", secret)
				.update(`${PURPOSE}:response:${envelope.signature}:${status}`)
				.digest(),
		),
	);
}
function monitorAirsideInferenceStream(
	response: Response,
	envelope: AirsideInferenceEnvelope,
	options: AirsideGatewayFetchOptions,
	signal?: AbortSignal | null,
): Response {
	if (
		!response.body ||
		!response.headers.get("content-type")?.includes("text/event-stream")
	) {
		return response;
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let tail = "";
	let notified = false;
	function infrastructureError() {
		const error = new AirsideGatewayInfrastructureError();
		if (!notified) {
			notified = true;
			options.onInfrastructureError?.(error);
		}
		return error;
	}
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			try {
				const { value, done } = await reader.read();
				if (done) {
					controller.close();
					return;
				}
				const text = tail + decoder.decode(value, { stream: true });
				const marker =
					/(?:^|\n)event: airside-infrastructure-error\r?\ndata: ([0-9a-f]{64})\r?\n\r?\n/.exec(
						text,
					);
				if (marker && validAirsideInferenceSignature(marker[1], envelope, 0)) {
					controller.error(infrastructureError());
					await reader.cancel();
					return;
				}
				tail = text.slice(-512);
				controller.enqueue(value);
			} catch (error) {
				controller.error(signal?.aborted ? error : infrastructureError());
			}
		},
		async cancel(reason) {
			await reader.cancel(reason);
		},
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}
