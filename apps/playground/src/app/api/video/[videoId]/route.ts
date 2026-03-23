import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
	getGatewayErrorMessage,
	readGatewayResponseBody,
} from "@/app/api/video/utils";
import { getUser } from "@/lib/getUser";

export const dynamic = "force-dynamic";

export async function GET(
	_req: Request,
	{ params }: { params: Promise<{ videoId: string }> },
) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { videoId } = await params;

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

	const response = await fetch(
		`${gatewayBaseUrl}/v1/videos/${encodeURIComponent(videoId)}`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"x-source": "chat.llmgateway.io",
			},
			cache: "no-store",
		},
	);

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
