import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { models as modelDefinitions } from "@llmgateway/models";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export const maxDuration = 30;

interface RealtimeSessionRequestBody {
	model: string;
}

/**
 * Upstream provider serving the requested realtime model, resolved the same
 * way the gateway pins it: first active `realtime: true` mapping, honoring a
 * "provider/model" pinned form.
 */
function resolveRealtimeProviderId(requestedModel: string): string | null {
	let requestedProvider: string | undefined;
	let modelKey = requestedModel;
	const slashIdx = requestedModel.indexOf("/");
	if (slashIdx > 0) {
		requestedProvider = requestedModel.slice(0, slashIdx);
		modelKey = requestedModel.slice(slashIdx + 1);
	}
	const now = new Date();
	for (const rawModel of modelDefinitions) {
		const model = rawModel as ModelDefinition;
		if (model.id !== modelKey && !model.aliases?.includes(modelKey)) {
			continue;
		}
		for (const mapping of model.providers as readonly ProviderModelMapping[]) {
			if (mapping.realtime !== true) {
				continue;
			}
			if (requestedProvider && mapping.providerId !== requestedProvider) {
				continue;
			}
			if (mapping.deactivatedAt && now > mapping.deactivatedAt) {
				continue;
			}
			return mapping.providerId;
		}
	}
	return null;
}

/**
 * Default catalogue-backed ASR model for the provider: the first active
 * `realtimeTranscription: true` mapping in definition order, as a
 * provider-pinned model string.
 */
function resolveDefaultTranscriptionModel(providerId: string): string | null {
	const now = new Date();
	for (const model of modelDefinitions) {
		for (const mapping of model.providers as readonly ProviderModelMapping[]) {
			if (mapping.realtimeTranscription !== true) {
				continue;
			}
			if (mapping.providerId !== providerId) {
				continue;
			}
			if (mapping.deactivatedAt && now > mapping.deactivatedAt) {
				continue;
			}
			return `${mapping.providerId}/${model.id}`;
		}
	}
	return null;
}

function getGatewayErrorMessage(body: unknown, fallback: string): string {
	if (body && typeof body === "object" && "error" in body) {
		const error = (body as { error: unknown }).error;
		if (
			error &&
			typeof error === "object" &&
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
		) {
			return (error as { message: string }).message;
		}
		if (typeof error === "string" && error.length > 0) {
			return error;
		}
	}
	if (typeof body === "string" && body.length > 0) {
		return body;
	}
	return fallback;
}

/**
 * Deployment-internal WebSocket URL for /v1/realtime. Derived from
 * GATEWAY_URL in production (the ingress splits WebSocket upgrades off to
 * the realtime service on the same public host); an explicit server-only
 * override is available for unusual deployments. In local dev the gateway
 * hosts the realtime proxy inline (REALTIME_INLINE), so the WebSocket lives
 * on the main gateway port rather than the dedicated realtime service.
 */
function resolveRealtimeWsUrl(): string {
	const override = process.env.REALTIME_WS_URL;
	if (override) {
		return override;
	}
	const gatewayUrl = process.env.GATEWAY_URL?.replace(/\/v1$/, "");
	if (gatewayUrl) {
		return `${gatewayUrl.replace(/^http/, "ws")}/v1/realtime`;
	}
	return process.env.NODE_ENV === "development"
		? "ws://localhost:4001/v1/realtime"
		: "wss://api.llmgateway.io/v1/realtime";
}

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const cookieStore = await cookies();
	const apiKey = getPlaygroundKeyForRequest(cookieStore, req);

	if (!apiKey) {
		return NextResponse.json({ error: "Missing API key" }, { status: 400 });
	}

	let body: RealtimeSessionRequestBody;
	try {
		body = (await req.json()) as RealtimeSessionRequestBody;
	} catch {
		return NextResponse.json(
			{ error: "Invalid JSON payload" },
			{ status: 400 },
		);
	}

	if (typeof body.model !== "string" || !body.model.trim()) {
		return NextResponse.json(
			{ error: "Missing realtime model" },
			{ status: 400 },
		);
	}
	const model = body.model.trim();

	const providerId = resolveRealtimeProviderId(model);
	if (!providerId) {
		return NextResponse.json(
			{ error: `Unknown realtime model: ${model}` },
			{ status: 400 },
		);
	}

	// Gemini Live transcribes natively: transcription is enabled in the session
	// setup and billed through Gemini's own usageMetadata, so there is no
	// separate ASR model to resolve or pin. Every other provider needs a
	// billable, catalogue-backed ASR model for the user transcript bubbles, and
	// fails rather than starting a session with unmetered (or silently missing)
	// transcription.
	const usesNativeTranscription = providerId === "google-ai-studio";
	const transcriptionModel = usesNativeTranscription
		? null
		: resolveDefaultTranscriptionModel(providerId);
	if (!usesNativeTranscription && !transcriptionModel) {
		return NextResponse.json(
			{
				error:
					"No transcription model is available for this realtime provider. Voice calls are temporarily unavailable.",
			},
			{ status: 503 },
		);
	}

	const gatewayBaseUrl =
		process.env.GATEWAY_URL?.replace(/\/v1$/, "") ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001"
			: "https://api.llmgateway.io");

	// Forward the trusted ingress-derived originating IP so mint-time IAM
	// checks see the browser's IP; the WebSocket upgrade preflight still
	// rechecks the direct connection's IP.
	const forwardedFor = req.headers.get("x-forwarded-for");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 25_000);

	let response: Response;
	try {
		response = await fetch(`${gatewayBaseUrl}/v1/realtime/client_secrets`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"x-source": LOUNGE_SOURCE,
				...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
			},
			body: JSON.stringify({
				expires_after: {
					anchor: "created_at",
					seconds: 60,
				},
				session: {
					type: "realtime",
					model,
					...(transcriptionModel
						? {
								audio: {
									input: {
										transcription: {
											model: transcriptionModel,
										},
									},
								},
							}
						: {}),
				},
			}),
			signal: controller.signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return NextResponse.json(
				{ error: "Realtime session setup timed out" },
				{ status: 504 },
			);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	const text = await response.text();
	let parsed: unknown = null;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	}

	if (!response.ok) {
		return NextResponse.json(
			{
				error: getGatewayErrorMessage(
					parsed,
					"Failed to start a realtime session",
				),
			},
			{ status: response.status },
		);
	}

	const secret = parsed as {
		value?: string;
		expires_at?: number;
		session?: { type: string; model: string };
	};
	if (!secret?.value) {
		return NextResponse.json(
			{ error: "Gateway returned an invalid client secret" },
			{ status: 502 },
		);
	}

	// The playground API key itself must never reach the browser; only the
	// short-lived client secret and connection metadata do.
	return NextResponse.json({
		client_secret: secret.value,
		expires_at: secret.expires_at,
		session: secret.session ?? { type: "realtime", model },
		transcription_model: transcriptionModel,
		provider: providerId,
		ws_url: resolveRealtimeWsUrl(),
	});
}
