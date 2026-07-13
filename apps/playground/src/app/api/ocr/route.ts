import { cookies } from "next/headers";

import { PLAYGROUND_KEY_COOKIE_NAME } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

export const maxDuration = 300; // 5 minutes

// Abort the upstream OCR call before the route's max duration so a hung
// gateway surfaces as a 504 instead of an opaque platform timeout.
const UPSTREAM_TIMEOUT_MS = 280_000;

interface OcrRequestBody {
	model?: string;
	document?: unknown;
	pages?: number[] | string;
	include_image_base64?: boolean;
	apiKey?: string;
}

// Treat empty/whitespace strings as absent so a blank body `apiKey` does not
// shadow a valid header or cookie key during fallback resolution.
function nonEmpty(value: string | null | undefined): string | undefined {
	return value && value.trim() ? value : undefined;
}

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return jsonResponse({ error: "Unauthorized" }, 401);
	}

	let body: OcrRequestBody;
	try {
		const parsed: unknown = await req.json();
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			return jsonResponse({ error: "Invalid request body" }, 400);
		}
		body = parsed as OcrRequestBody;
	} catch {
		return jsonResponse({ error: "Invalid JSON body" }, 400);
	}

	const { model, document, pages, include_image_base64, apiKey } = body;

	if (!model || typeof model !== "string") {
		return jsonResponse({ error: "Missing model" }, 400);
	}

	if (!document) {
		return jsonResponse({ error: "Missing document" }, 400);
	}

	const headerApiKey = nonEmpty(req.headers.get("x-llmgateway-key"));
	const noFallbackHeader = nonEmpty(req.headers.get("x-no-fallback"));

	const cookieStore = await cookies();
	const cookieApiKey = nonEmpty(
		cookieStore.get(PLAYGROUND_KEY_COOKIE_NAME)?.value ??
			cookieStore.get(`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`)?.value,
	);
	const finalApiKey = nonEmpty(apiKey) ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return jsonResponse({ error: "Missing API key" }, 400);
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	let upstream: Response;
	try {
		upstream = await fetch(`${gatewayUrl}/ocr`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${finalApiKey}`,
				"x-source": "chat.llmgateway.io",
				...(noFallbackHeader ? { "x-no-fallback": noFallbackHeader } : {}),
			},
			body: JSON.stringify({
				model,
				document,
				...(pages !== undefined ? { pages } : {}),
				...(include_image_base64 !== undefined ? { include_image_base64 } : {}),
			}),
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		});
	} catch (error) {
		const timedOut =
			error instanceof Error &&
			(error.name === "TimeoutError" || error.name === "AbortError");
		return jsonResponse(
			{
				error: timedOut
					? "OCR request timed out"
					: "OCR upstream request failed",
			},
			timedOut ? 504 : 502,
		);
	}

	let responseBody: string;
	try {
		responseBody = await upstream.text();
	} catch {
		return jsonResponse({ error: "Failed to read OCR response" }, 502);
	}

	return new Response(responseBody, {
		status: upstream.status,
		headers: {
			"Content-Type":
				upstream.headers.get("content-type") ?? "application/json",
		},
	});
}
