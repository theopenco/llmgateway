import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import { getGatewayErrorMessage, readGatewayResponseBody } from "./utils";

export const maxDuration = 60;

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

	const requestBody = await req.json();
	const noFallback = req.headers.get("x-no-fallback");

	const response = await fetch(`${getGatewayApiBaseUrl()}/videos`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
			"x-source": LOUNGE_SOURCE,
			...(noFallback ? { "x-no-fallback": noFallback } : {}),
		},
		body: JSON.stringify(requestBody),
	});

	const responseBody = await readGatewayResponseBody(response);

	if (!response.ok) {
		return NextResponse.json(
			{ error: getGatewayErrorMessage(responseBody, "Video creation failed") },
			{ status: response.status },
		);
	}

	return NextResponse.json(responseBody);
}
