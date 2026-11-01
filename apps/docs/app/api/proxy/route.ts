import { openapi } from "@/lib/source";

import { forwardedIpHeaders } from "@llmgateway/shared/client-ip";
import {
	getGatewayBackendBaseUrl,
	getGatewayPublicBaseUrl,
} from "@llmgateway/shared/gateway-url";

async function proxy(request: Request) {
	const gatewayBase = new URL(getGatewayPublicBaseUrl());
	const gatewayOrigin = gatewayBase.origin;
	// Skip Fumadocs' buffering path; the override forwards the original stream.
	const proxyHeaders = new Headers(request.headers);
	proxyHeaders.delete("content-length");
	const proxyRequest = new Request(request.url, {
		method: request.method,
		headers: proxyHeaders,
		signal: request.signal,
	});
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
					const withBody = request.body
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
					const publicPath = gatewayBase.pathname.replace(/\/+$/, "");
					let targetPath = target.pathname;
					if (
						targetPath === publicPath ||
						targetPath.startsWith(`${publicPath}/`)
					) {
						targetPath = targetPath.slice(publicPath.length) || "/";
					}
					backend.pathname = `${backend.pathname.replace(/\/+$/, "")}${targetPath}`;
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
		.handle(proxyRequest);
}

export {
	proxy as GET,
	proxy as HEAD,
	proxy as PUT,
	proxy as POST,
	proxy as PATCH,
	proxy as DELETE,
};
