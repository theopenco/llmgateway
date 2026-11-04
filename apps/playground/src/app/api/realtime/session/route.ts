import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";
import { transcribesInputNatively } from "@/lib/realtime-transcription";

import { models as modelDefinitions } from "@llmgateway/models";
import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";
import {
	getGatewayPublicBaseUrl,
	getRealtimeApiBaseUrl,
} from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import type { ModelDefinition, ProviderModelMapping } from "@llmgateway/models";

export const maxDuration = 30;

type RealtimeSessionType = "realtime" | "transcription";

interface RealtimeSessionRequestBody {
	model: string;
	/** Speech-to-speech by default; "transcription" opens a transcription-only session. */
	type?: RealtimeSessionType;
	transcriptionModel?: string;
}

/**
 * Catalogue mapping serving the requested session model, resolved the same
 * way the gateway pins it: first active mapping with the session's capability
 * (`realtime` for speech-to-speech, `realtimeTranscription` for a
 * transcription-only session), honoring a "provider/model" pinned form.
 */
function resolveSessionMapping(
	requestedModel: string,
	capability: "realtime" | "realtimeTranscription",
): ProviderModelMapping | null {
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
			return mapping;
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

	let providerId: string;
	let session: Record<string, unknown>;
	if (sessionType === "transcription") {
		// The transcription model is the session's only model; the gateway pins
		// it at mint time and again at connection time.
		const mapping = resolveSessionMapping(model, "realtimeTranscription");
		if (!mapping) {
			return NextResponse.json(
				{ error: `Unknown realtime transcription model: ${model}` },
				{ status: 400 },
			);
		}
		providerId = mapping.providerId;
		session = {
			type: "transcription",
			audio: { input: { transcription: { model } } },
		};
	} else {
		const mapping = resolveSessionMapping(model, "realtime");
		if (!mapping) {
			return NextResponse.json(
				{ error: `Unknown realtime model: ${model}` },
				{ status: 400 },
			);
		}
		providerId = mapping.providerId;
		if (
			body.transcriptionModel !== undefined &&
			typeof body.transcriptionModel !== "string"
		) {
			return NextResponse.json(
				{ error: "Invalid transcription model" },
				{ status: 400 },
			);
		}
		const transcriptionModel = body.transcriptionModel?.trim() || null;
		if (!transcriptionModel && !transcribesInputNatively(mapping)) {
			return NextResponse.json(
				{ error: "Choose a transcription model for this realtime model." },
				{ status: 400 },
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
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 25_000);

	let response: Response;
	try {
		response = await fetch(
			`${getRealtimeApiBaseUrl()}/realtime/client_secrets`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
					"x-source": LOUNGE_SOURCE,
					...forwardedIpHeaders(req.headers),
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
		provider: providerId,
		ws_url: resolveRealtimeWsUrl(),
	});
}
