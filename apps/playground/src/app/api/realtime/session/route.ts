import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { models as modelDefinitions } from "@llmgateway/models";
import {
	getGatewayApiBaseUrl,
	getGatewayPublicBaseUrl,
} from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export const maxDuration = 30;

type RealtimeSessionType = "realtime" | "transcription";

interface RealtimeSessionRequestBody {
	model: string;
	/** Speech-to-speech by default; "transcription" opens a transcription-only session. */
	type?: RealtimeSessionType;
}

/**
 * Upstream provider serving the requested session model, resolved the same
 * way the gateway pins it: first active mapping with the session's capability
 * (`realtime` for speech-to-speech, `realtimeTranscription` for a
 * transcription-only session), honoring a "provider/model" pinned form.
 */
function resolveSessionProviderId(
	requestedModel: string,
	capability: "realtime" | "realtimeTranscription",
): string | null {
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
			if (mapping[capability] !== true) {
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
	return `${getGatewayPublicBaseUrl().replace(/^http/, "ws")}/v1/realtime`;
}

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const cookieStore = await cookies();
	const apiKey = getPlaygroundKeyForRequest(cookieStore);

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
	if (
		body.type !== undefined &&
		body.type !== "realtime" &&
		body.type !== "transcription"
	) {
		return NextResponse.json(
			{ error: "Unsupported session type" },
			{ status: 400 },
		);
	}
	const sessionType: RealtimeSessionType = body.type ?? "realtime";

	let providerId: string | null;
	let transcriptionModel: string | null;
	let session: Record<string, unknown>;
	if (sessionType === "transcription") {
		// The transcription model is the session's only model; the gateway pins
		// it at mint time and again at connection time.
		providerId = resolveSessionProviderId(model, "realtimeTranscription");
		if (!providerId) {
			return NextResponse.json(
				{ error: `Unknown realtime transcription model: ${model}` },
				{ status: 400 },
			);
		}
		transcriptionModel = model;
		session = {
			type: "transcription",
			audio: { input: { transcription: { model } } },
		};
	} else {
		providerId = resolveSessionProviderId(model, "realtime");
		if (!providerId) {
			return NextResponse.json(
				{ error: `Unknown realtime model: ${model}` },
				{ status: 400 },
			);
		}

		// Gemini Live transcribes natively: transcription is enabled in the
		// session setup and billed through Gemini's own usageMetadata, so there
		// is no separate ASR model to resolve or pin. Every other provider needs
		// a billable, catalogue-backed ASR model for the user transcript bubbles,
		// and fails rather than starting a session with unmetered (or silently
		// missing) transcription.
		const usesNativeTranscription = providerId === "google-ai-studio";
		transcriptionModel = usesNativeTranscription
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
		session = {
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
		};
	}

	// Forward the trusted ingress-derived originating IP so mint-time IAM
	// checks see the browser's IP; the WebSocket upgrade preflight still
	// rechecks the direct connection's IP.
	const forwardedFor = req.headers.get("x-forwarded-for");

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 25_000);

	let response: Response;
	try {
		response = await fetch(
			`${getGatewayApiBaseUrl()}/realtime/client_secrets`,
			{
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
					session,
				}),
				signal: controller.signal,
			},
		);
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
		session?: Record<string, unknown>;
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
		session: secret.session ?? session,
		transcription_model: transcriptionModel,
		provider: providerId,
		ws_url: resolveRealtimeWsUrl(),
	});
}
