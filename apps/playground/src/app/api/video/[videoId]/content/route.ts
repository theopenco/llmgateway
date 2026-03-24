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
		`${gatewayBaseUrl}/v1/videos/${encodeURIComponent(videoId)}/content`,
		{
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"x-source": "chat.llmgateway.io",
			},
			cache: "no-store",
		},
	);

	if (!response.ok || !response.body) {
		const body = await readGatewayResponseBody(response);
		return NextResponse.json(
			{ error: getGatewayErrorMessage(body, "Failed to fetch video content") },
			{ status: response.status },
		);
	}

	return new Response(response.body, {
		status: 200,
		headers: {
			"Content-Type": response.headers.get("Content-Type") ?? "video/mp4",
			"Cache-Control": "private, max-age=3600",
			...(response.headers.get("Content-Length")
				? { "Content-Length": response.headers.get("Content-Length")! }
				: {}),
		},
	});
}
