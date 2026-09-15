import createClient from "openapi-fetch";

import { ensureGatewayKey } from "@/api/completion";
import { assertResponseOk } from "@/api/errors";
import { config } from "@/config";

import { LOUNGE_SOURCE } from "@llmgateway/shared/lounge-source";

import type { paths } from "@/lib/api/gateway";

export async function gatewayClient(projectId: string) {
	const token = await ensureGatewayKey(projectId);
	const gateway = createClient<paths>({
		baseUrl: config.gatewayUrl.replace(/\/v1\/?$/, ""),
		headers: { Authorization: `Bearer ${token}`, "x-source": LOUNGE_SOURCE },
	});
	gateway.use({ onResponse: ({ response }) => assertResponseOk(response) });
	return gateway;
}

export function imageMediaType(base64: string) {
	if (base64.startsWith("/9j/")) {
		return "image/jpeg";
	}
	if (base64.startsWith("UklGR")) {
		return "image/webp";
	}
	return "image/png";
}
