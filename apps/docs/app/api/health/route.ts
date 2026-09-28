import { headers } from "next/headers";

import {
	getClientIpFromHeaders,
	getClientIpHeaderName,
} from "@llmgateway/shared/client-ip";

export async function GET() {
	return Response.json({
		status: "ok",
		sha: process.env.APP_VERSION ?? "v0.0.0-unknown",
		clientIp: getClientIpFromHeaders(await headers()),
		clientIpHeader: getClientIpHeaderName(),
	});
}
