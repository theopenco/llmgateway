import { getConfig } from "@/lib/config-server";

export const runtime = "nodejs";

export async function POST(req: Request) {
	const config = getConfig();
	const target = `${config.apiBackendUrl}/public/chat-support/escalate`;

	const headers: Record<string, string> = {
		"content-type": req.headers.get("content-type") ?? "application/json",
	};

	const userAgent = req.headers.get("user-agent");
	if (userAgent) {
		headers["user-agent"] = userAgent;
	}

	const forwardedFor = req.headers.get("x-forwarded-for");
	if (forwardedFor) {
		headers["x-forwarded-for"] = forwardedFor;
	}

	const cfConnectingIp = req.headers.get("cf-connecting-ip");
	if (cfConnectingIp) {
		headers["cf-connecting-ip"] = cfConnectingIp;
	}

	const realIp = req.headers.get("x-real-ip");
	if (realIp) {
		headers["x-real-ip"] = realIp;
	}

	const body = await req.text();

	const upstream = await fetch(target, {
		method: "POST",
		headers,
		body,
	});

	const responseBody = await upstream.text();
	return new Response(responseBody, {
		status: upstream.status,
		headers: {
			"content-type":
				upstream.headers.get("content-type") ?? "application/json",
		},
	});
}
