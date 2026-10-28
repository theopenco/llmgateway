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
					// Fumadocs drops bodies without Content-Length; retain the original stream.
					const withBody =
						!proxied.body && request.body
							? new Request(proxied, request)
							: proxied;
					const headers = new Headers(proxied.headers);
					headers.delete("transfer-encoding");
					const forwarded = new Request(withBody, { headers });
					const target = new URL(forwarded.url);
					if (target.origin !== gatewayOrigin) {
						return forwarded;
					}
					const backend = new URL(getGatewayBackendBaseUrl());
					backend.pathname = target.pathname;
					backend.search = target.search;
					return new Request(new Request(backend, forwarded), {
						headers: {
							...Object.fromEntries(forwarded.headers),
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
