import { getConfig } from "@/lib/config-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
	const config = getConfig();
	const target = `${config.apiBackendUrl}/public/chat-support`;

	const headers: Record<string, string> = {
		"content-type": req.headers.get("content-type") ?? "application/json",
	};

	const userAgent = req.headers.get("user-agent");
	if (userAgent) {
		headers["user-agent"] = userAgent;
	}

	// Forward the visitor's `x-forwarded-for` — the header the load balancer in
	// front of us sets and the one the backend reads back. Without it every
	// visitor reaches the backend from this server's address and shares a
	// single per-IP rate-limit bucket.
	const forwardedFor = req.headers.get("x-forwarded-for");
	if (forwardedFor) {
		headers["x-forwarded-for"] = forwardedFor;
	}

	const upstream = await fetch(target, {
		method: "POST",
		headers,
		body: req.body,
		// Required by Node/Undici when forwarding a streaming body.
		duplex: "half",
	} as RequestInit & { duplex: "half" });

	const responseHeaders = new Headers();
	const contentType = upstream.headers.get("content-type");
	if (contentType) {
		responseHeaders.set("content-type", contentType);
	}
	const uiStreamHeader = upstream.headers.get("x-vercel-ai-ui-message-stream");
	if (uiStreamHeader) {
		responseHeaders.set("x-vercel-ai-ui-message-stream", uiStreamHeader);
	}
	responseHeaders.set("cache-control", "no-cache, no-transform");
	responseHeaders.set("x-accel-buffering", "no");

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders,
	});
}
