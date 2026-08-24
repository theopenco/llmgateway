import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
	getGatewayErrorMessage,
	readGatewayResponseBody,
} from "@/app/api/video/utils";
import { getPlaygroundKeyForRequest } from "@/lib/constants";
import { getUser } from "@/lib/getUser";

import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";
import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

export const dynamic = "force-dynamic";
export const maxDuration = 15;

const API_TIMEOUT_MS = 10_000;

function isTimeoutError(error: unknown): boolean {
	return error instanceof Error && error.name === "TimeoutError";
}

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ videoId: string }> },
) {
	let user: Awaited<ReturnType<typeof getUser>> = null;
	try {
		user = await getUser({
			signal: AbortSignal.timeout(API_TIMEOUT_MS),
		});
	} catch (error) {
		if (isTimeoutError(error)) {
			return NextResponse.json(
				{ error: "Authentication request timed out" },
				{ status: 504 },
			);
		}

		throw error;
	}

	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { videoId } = await params;

	const cookieStore = await cookies();
	const apiKey = getPlaygroundKeyForRequest(cookieStore);

	if (!apiKey) {
		return NextResponse.json({ error: "Missing API key" }, { status: 400 });
	}

	let response: Response;
	try {
		response = await fetch(
			`${getGatewayApiBaseUrl()}/videos/${encodeURIComponent(videoId)}`,
			{
				headers: {
					Authorization: `Bearer ${apiKey}`,
					"x-source": LOUNGE_SOURCE,
				},
				cache: "no-store",
				signal: AbortSignal.timeout(API_TIMEOUT_MS),
			},
		);
	} catch (error) {
		if (isTimeoutError(error)) {
			return NextResponse.json(
				{ error: "Video status request timed out" },
				{ status: 504 },
			);
		}

		throw error;
	}

	const body = await readGatewayResponseBody(response);

	if (!response.ok) {
		return NextResponse.json(
			{ error: getGatewayErrorMessage(body, "Failed to fetch video status") },
			{ status: response.status },
		);
	}

	return NextResponse.json(body, {
		headers: {
			"Cache-Control": "no-store, no-cache, must-revalidate",
		},
	});
}
