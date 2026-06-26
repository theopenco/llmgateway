import { cookies } from "next/headers";

import { PLAYGROUND_KEY_COOKIE_NAME } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

export const maxDuration = 300; // 5 minutes

interface OcrRequestBody {
	model?: string;
	document?: unknown;
	pages?: number[] | string;
	include_image_base64?: boolean;
	apiKey?: string;
}

export async function POST(req: Request) {
	const user = await getUser();

	if (!user) {
		return new Response(JSON.stringify({ error: "Unauthorized" }), {
			status: 401,
		});
	}

	const body: OcrRequestBody = await req.json();
	const { model, document, pages, include_image_base64, apiKey } = body;

	if (!model || typeof model !== "string") {
		return new Response(JSON.stringify({ error: "Missing model" }), {
			status: 400,
		});
	}

	if (!document) {
		return new Response(JSON.stringify({ error: "Missing document" }), {
			status: 400,
		});
	}

	const headerApiKey = req.headers.get("x-llmgateway-key") ?? undefined;
	const noFallbackHeader = req.headers.get("x-no-fallback") ?? undefined;

	const cookieStore = await cookies();
	const cookieApiKey =
		cookieStore.get(PLAYGROUND_KEY_COOKIE_NAME)?.value ??
		cookieStore.get(`__Host-${PLAYGROUND_KEY_COOKIE_NAME}`)?.value;
	const finalApiKey = apiKey ?? headerApiKey ?? cookieApiKey;
	if (!finalApiKey) {
		return new Response(JSON.stringify({ error: "Missing API key" }), {
			status: 400,
		});
	}

	const gatewayUrl =
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1");

	const upstream = await fetch(`${gatewayUrl}/ocr`, {
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
	});

	const responseBody = await upstream.text();
	return new Response(responseBody, {
		status: upstream.status,
		headers: {
			"Content-Type":
				upstream.headers.get("content-type") ?? "application/json",
		},
	});
}
