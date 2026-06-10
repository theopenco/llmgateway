import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { PLAYGROUND_KEY_COOKIE_NAME } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

export const maxDuration = 120;

interface AudioRequestBody {
	model: string;
	input: string;
	voice?: string;
	response_format?: string;
	speed?: number;
	instructions?: string;
}

function getSpeechErrorMessage(body: unknown, fallback: string): string {
	if (typeof body === "string" && body.length > 0) {
		return body;
	}
	if (body && typeof body === "object" && "error" in body) {
		const error = (body as { error: unknown }).error;
		if (typeof error === "string" && error.length > 0) {
			return error;
		}
		if (
			error &&
			typeof error === "object" &&
			"message" in error &&
			typeof (error as { message: unknown }).message === "string"
		) {
			return (error as { message: string }).message;
		}
	}
	return fallback;
}

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const cookieStore = await cookies();
	const apiKey =
		cookieStore.get(PLAYGROUND_KEY_COOKIE_NAME)?.value ??
		cookieStore.get(`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`)?.value;

	if (!apiKey) {
		return NextResponse.json({ error: "Missing API key" }, { status: 400 });
	}

	let body: AudioRequestBody;
	try {
		body = (await req.json()) as AudioRequestBody;
	} catch {
		return NextResponse.json(
			{ error: "Invalid JSON payload" },
			{ status: 400 },
		);
	}

	if (!body.input?.trim()) {
		return NextResponse.json(
			{ error: "Missing input text for speech generation" },
			{ status: 400 },
		);
	}

	const gatewayBaseUrl =
		process.env.GATEWAY_URL?.replace(/\/v1$/, "") ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001"
			: "https://api.llmgateway.io");

	const noFallback = req.headers.get("x-no-fallback");

	// Abort just under maxDuration so a hung gateway connection surfaces as a
	// 504 instead of an opaque function timeout. Long TTS inputs can take well
	// over a minute, so the timeout stays generous.
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 110_000);

	let response: Response;
	try {
		response = await fetch(`${gatewayBaseUrl}/v1/audio/speech`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"x-source": "chat.llmgateway.io",
				...(noFallback ? { "x-no-fallback": noFallback } : {}),
			},
			body: JSON.stringify({
				model: body.model,
				input: body.input,
				...(body.voice ? { voice: body.voice } : {}),
				...(body.response_format
					? { response_format: body.response_format }
					: {}),
				...(body.speed !== undefined ? { speed: body.speed } : {}),
				...(body.instructions ? { instructions: body.instructions } : {}),
			}),
			signal: controller.signal,
		});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			return NextResponse.json(
				{ error: "Speech generation timed out" },
				{ status: 504 },
			);
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}

	if (!response.ok) {
		const text = await response.text();
		let parsed: unknown = null;
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = text;
			}
		}
		return NextResponse.json(
			{ error: getSpeechErrorMessage(parsed, "Speech generation failed") },
			{ status: response.status },
		);
	}

	const buffer = Buffer.from(await response.arrayBuffer());
	const mediaType = response.headers.get("content-type") ?? "audio/mpeg";

	return NextResponse.json({
		audio: { base64: buffer.toString("base64"), mediaType },
	});
}
