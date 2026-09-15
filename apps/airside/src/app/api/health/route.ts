import { NextResponse } from "next/server";

import { createServerApiClient } from "@/lib/server-api";

import { getClientIpFromHeaders } from "@llmgateway/shared/client-ip";

export async function GET(req: Request) {
	const body: Record<string, unknown> = {
		status: "ok",
		sha: process.env.APP_VERSION ?? null,
		clientIp: getClientIpFromHeaders(req.headers),
	};

	// Opt-in so liveness probes never depend on the API: reports the address
	// the API resolves for a call made on this visitor's behalf, which checks
	// the whole chain (edge header, this server's forwarding, in-cluster hop).
	if (new URL(req.url).searchParams.get("verify") === "client-ip") {
		const client = await createServerApiClient();
		const { data } = await client.GET("/");
		body.apiClientIp = data?.clientIp ?? null;
	}

	return NextResponse.json(body);
}
