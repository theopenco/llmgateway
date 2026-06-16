import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
	getGatewayErrorMessage,
	readGatewayResponseBody,
} from "@/app/api/video/utils";
import { getConfig } from "@/lib/config-server";
import { getUser } from "@/lib/getUser";

export const dynamic = "force-dynamic";

const SESSION_COOKIE_KEY = "better-auth.session_token";
const STATUS_TIMEOUT_MS = 10_000;

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ videoId: string }> },
) {
	const user = await getUser();
	if (!user) {
		return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
	}

	const { videoId } = await params;

	const cookieStore = await cookies();
	const sessionCookie = cookieStore.get(SESSION_COOKIE_KEY);
	const secureSessionCookie = cookieStore.get(`__Secure-${SESSION_COOKIE_KEY}`);
	const cookieHeader = secureSessionCookie
		? `__Secure-${SESSION_COOKIE_KEY}=${secureSessionCookie.value}`
		: sessionCookie
			? `${SESSION_COOKIE_KEY}=${sessionCookie.value}`
			: "";

	// Resolve the signed, keyless content URL through the session-authorized API
	// (org-scoped access) rather than the project-scoped gateway API key, so
	// playback works for any video the user can access regardless of which
	// playground API key is currently active.
	const { apiBackendUrl } = getConfig();
	let statusResponse: Response;
	try {
		statusResponse = await fetch(
			`${apiBackendUrl}/video/${encodeURIComponent(videoId)}`,
			{
				headers: {
					Cookie: cookieHeader,
				},
				cache: "no-store",
				signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
			},
		);
	} catch (error) {
		if (error instanceof Error && error.name === "TimeoutError") {
			return NextResponse.json(
				{ error: "Video content request timed out" },
				{ status: 504 },
			);
		}
		throw error;
	}

	if (!statusResponse.ok) {
		const body = await readGatewayResponseBody(statusResponse);
		return NextResponse.json(
			{ error: getGatewayErrorMessage(body, "Failed to fetch video content") },
			{ status: statusResponse.status },
		);
	}

	const job = (await statusResponse.json()) as {
		content?: { url: string; mime_type?: string | null }[];
	};
	const sourceUrl = job.content?.[0]?.url;
	if (!sourceUrl) {
		return NextResponse.json(
			{ error: "Video content is not available yet" },
			{ status: 404 },
		);
	}

	// No timeout here: this streams the (potentially large) video body, and a
	// fixed timeout would abort slow but healthy downloads mid-stream.
	const rangeHeader = req.headers.get("Range");
	const response = await fetch(sourceUrl, {
		headers: {
			...(rangeHeader ? { Range: rangeHeader } : {}),
		},
		cache: "no-store",
	});

	if (!response.ok && response.status !== 206) {
		const body = await readGatewayResponseBody(response);
		return NextResponse.json(
			{ error: getGatewayErrorMessage(body, "Failed to fetch video content") },
			{ status: response.status },
		);
	}

	if (!response.body) {
		return NextResponse.json(
			{ error: "No video content returned" },
			{ status: 502 },
		);
	}

	const headers: Record<string, string> = {
		"Content-Type": response.headers.get("Content-Type") ?? "video/mp4",
		"Cache-Control": "private, max-age=3600",
		"Accept-Ranges": "bytes",
	};

	const contentLength = response.headers.get("Content-Length");
	if (contentLength) {
		headers["Content-Length"] = contentLength;
	}

	const contentRange = response.headers.get("Content-Range");
	if (contentRange) {
		headers["Content-Range"] = contentRange;
	}

	return new Response(response.body, {
		status: response.status,
		headers,
	});
}
