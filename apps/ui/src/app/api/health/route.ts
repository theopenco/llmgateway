import { headers } from "next/headers";

import { createServerApiClient } from "@/lib/server-api";

import {
	forwardedIpHeaders,
	getClientIpFromHeaders,
	getClientIpHeaderName,
} from "@llmgateway/shared/client-ip";

export async function GET(req: Request) {
	const requestHeaders = await headers();
	const body: Record<string, unknown> = {
		status: "ok",
		sha: process.env.APP_VERSION ?? "v0.0.0-unknown",
		clientIp: getClientIpFromHeaders(requestHeaders),
		clientIpHeader: getClientIpHeaderName(),
	};

	// Opt-in so liveness probes never depend on the API: reports the address
	// the API resolves for a call made on this visitor's behalf, which checks
	// the whole chain (edge header, this server's forwarding, in-cluster hop).
	if (new URL(req.url).searchParams.get("verify") === "client-ip") {
		const client = await createServerApiClient();
		const { data } = await client.GET("/", {
			headers: forwardedIpHeaders(requestHeaders),
		});
		body.apiClientIp = data?.clientIp ?? null;
	}

	return Response.json(body);
}
