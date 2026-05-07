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

	// Only forward `cf-connecting-ip`: Cloudflare overwrites any client-supplied
	// value, so it's the one IP header we can trust. Never pass through
	// `x-forwarded-for` or `x-real-ip` — clients can set those via fetch and
	// poison the backend's IP-based rate limiter.
	const cfConnectingIp = req.headers.get("cf-connecting-ip");
	if (cfConnectingIp) {
		headers["cf-connecting-ip"] = cfConnectingIp;
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
