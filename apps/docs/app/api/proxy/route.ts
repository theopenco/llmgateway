import { openapi } from "@/lib/source";

import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";
import {
	getGatewayBackendBaseUrl,
	getGatewayPublicBaseUrl,
} from "@llmgateway/shared/gateway-url";

async function proxy(request: Request) {
	const gatewayOrigin = new URL(getGatewayPublicBaseUrl()).origin;
	return await openapi
		.createProxy({
			allowedOrigins: [
				"https://docs.llmgateway.io",
				gatewayOrigin,
				"http://localhost:3005",
				"http://localhost:3006",
				...(process.env.API_URL ? [new URL(process.env.API_URL).origin] : []),
			],
			overrides: {
				request(proxied) {
					const target = new URL(proxied.url);
					if (target.origin !== gatewayOrigin) {
						return proxied;
					}
					const backend = new URL(getGatewayBackendBaseUrl());
					backend.pathname = target.pathname;
					backend.search = target.search;
					return new Request(new Request(backend, proxied), {
						headers: {
							...Object.fromEntries(proxied.headers),
							...forwardedIpHeaders(request.headers),
						},
						redirect: "error",
					});
				},
			},
		})
		.handle(request);
}

export {
	proxy as GET,
	proxy as HEAD,
	proxy as PUT,
	proxy as POST,
	proxy as PATCH,
	proxy as DELETE,
};
