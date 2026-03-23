import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getUser } from "@/lib/getUser";

import { getGatewayErrorMessage, readGatewayResponseBody } from "./utils";

export const maxDuration = 60;

function getVideoCreateProxyTimeoutMs(): number {
	const envValue = Number(process.env.PLAYGROUND_VIDEO_CREATE_TIMEOUT_MS);
	if (envValue > 0) {
		return envValue;
	}

	return Math.max(1000, maxDuration * 1000 - 5000);
}

function isTimeoutError(error: unknown): boolean {
	return error instanceof Error && error.name === "TimeoutError";
}

export async function POST(req: Request) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const cookieStore = await cookies();
	const apiKey =
		cookieStore.get("llmgateway_playground_key")?.value ??
		cookieStore.get("__Host-llmgateway_playground_key")?.value;

	if (!apiKey) {
		return NextResponse.json({ error: "Missing API key" }, { status: 400 });
	}

	const gatewayBaseUrl =
		process.env.GATEWAY_URL?.replace(/\/v1$/, "") ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001"
			: "https://api.llmgateway.io");

	const requestBody = await req.json();
	const noFallback = req.headers.get("x-no-fallback");

	let response: Response;
	try {
		response = await fetch(`${gatewayBaseUrl}/v1/videos`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				"x-source": "chat.llmgateway.io",
				...(noFallback ? { "x-no-fallback": noFallback } : {}),
			},
			body: JSON.stringify(requestBody),
			signal: AbortSignal.timeout(getVideoCreateProxyTimeoutMs()),
		});
	} catch (error) {
		if (isTimeoutError(error)) {
			return NextResponse.json(
				{
					error:
						"Video creation timed out before the gateway responded. Please try again.",
				},
				{ status: 504 },
			);
		}

		throw error;
	}

	const responseBody = await readGatewayResponseBody(response);

	if (!response.ok) {
		return NextResponse.json(
			{ error: getGatewayErrorMessage(responseBody, "Video creation failed") },
			{ status: response.status },
		);
	}

	return NextResponse.json(responseBody);
}
