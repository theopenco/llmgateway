import {
	createHash,
	createHmac,
	randomBytes,
	timingSafeEqual,
} from "node:crypto";

import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
	OAuthClientInformationSchema,
	OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod/v4";

import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import {
	connectorCallback,
	connectorClient,
	mcpEndpoints,
	nativeOAuth,
} from "./catalogue.js";

import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";

export const credentialsSchema = z.object({
	tokens: OAuthTokensSchema.optional(),
	client: OAuthClientInformationSchema.optional(),
	verifier: z.string().optional(),
	expiresAt: z.number().optional(),
	shop: z.string().optional(),
	returnTo: z.string().optional(),
});
export type ConnectorCredentials = z.infer<typeof credentialsSchema>;

export async function connectorFetch(input: string | URL, init?: RequestInit) {
	const response = await fetchSafeUserUrl(input, {
		...init,
		signal: init?.signal
			? AbortSignal.any([init.signal, AbortSignal.timeout(30_000)])
			: AbortSignal.timeout(30_000),
	});
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

export function mcpOAuthProvider(
	id: LoungeConnectorId,
	credentials: ConnectorCredentials,
	persist: () => Promise<void>,
	redirect: (url: URL) => void,
	state?: string,
): OAuthClientProvider {
	const configured = connectorClient(id);
	return {
		redirectUrl: connectorCallback(id),
		clientMetadata: {
			client_name: "The Lounge",
			redirect_uris: [connectorCallback(id)],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method: configured.clientSecret
				? "client_secret_post"
				: "none",
		},
		state: () => {
			if (!state) {
				throw new HTTPException(409, { message: "Reconnect this connector" });
			}
			return state;
		},
		clientInformation: () =>
			configured.clientId
				? {
						client_id: configured.clientId,
						client_secret: configured.clientSecret,
					}
				: credentials.client,
		saveClientInformation: async (client) => {
			credentials.client = client;
			await persist();
		},
		tokens: () => credentials.tokens,
		saveTokens: async (tokens) => {
			credentials.tokens = {
				...tokens,
				refresh_token:
					tokens.refresh_token ?? credentials.tokens?.refresh_token,
			};
			const lifetimeMs = (tokens.expires_in ?? 0) * 1000;
			credentials.expiresAt = lifetimeMs ? Date.now() + lifetimeMs : undefined;
			await persist();
		},
		redirectToAuthorization: redirect,
		saveCodeVerifier: async (verifier) => {
			credentials.verifier = verifier;
			await persist();
		},
		codeVerifier: () => {
			if (!credentials.verifier) {
				throw new HTTPException(400, {
					message: "Authorization expired. Try connecting again.",
				});
			}
			return credentials.verifier;
		},
		invalidateCredentials: async (scope) => {
			if (scope === "all" || scope === "tokens") {
				delete credentials.tokens;
				delete credentials.expiresAt;
			}
			if (scope === "all" || scope === "client") {
				delete credentials.client;
			}
			if (scope === "all" || scope === "verifier") {
				delete credentials.verifier;
			}
			await persist();
		},
	};
}

export async function beginAuthorization(
	id: LoungeConnectorId,
	state: string,
	credentials: ConnectorCredentials,
): Promise<string> {
	const native = nativeOAuth(id, credentials.shop);
	if (native) {
		const { clientId } = connectorClient(id);
		if (!clientId) {
			throw new HTTPException(503, {
				message: "This connector is not configured yet",
			});
		}
		const url = new URL(native.authorize);
		url.search = new URLSearchParams({
			client_id: clientId,
			redirect_uri: connectorCallback(id),
			response_type: "code",
			scope: native.scope,
			state,
		}).toString();
		if (id !== "shopify") {
			credentials.verifier = randomBytes(32).toString("base64url");
			url.searchParams.set(
				"code_challenge",
				createHash("sha256").update(credentials.verifier).digest("base64url"),
			);
			url.searchParams.set("code_challenge_method", "S256");
		} else {
			url.searchParams.set("grant_options[]", "per-user");
		}
		if (id === "gmail" || id === "google-drive") {
			url.searchParams.set("access_type", "offline");
			url.searchParams.set("prompt", "consent");
		}
		return url.toString();
	}
	const endpoint = mcpEndpoints[id];
	if (!endpoint) {
		throw new HTTPException(400, { message: "Unknown connector" });
	}
	let authorizationUrl: string | undefined;
	const provider = mcpOAuthProvider(
		id,
		credentials,
		async () => {},
		(url) => {
			authorizationUrl = url.toString();
		},
		state,
	);
	await auth(provider, { serverUrl: endpoint, fetchFn: connectorFetch });
	if (!authorizationUrl) {
		throw new HTTPException(502, {
			message: "The connector did not start authorization",
		});
	}
	return authorizationUrl;
}

export function verifyShopifyCallback(query: URLSearchParams, shop: string) {
	const secret = connectorClient("shopify").clientSecret;
	const signature = query.get("hmac");
	if (
		!secret ||
		!signature ||
		!/^[a-f0-9]{64}$/.test(signature) ||
		query.get("shop") !== shop
	) {
		throw new HTTPException(400, { message: "Invalid store authorization" });
	}
	const values = [...query.entries()]
		.filter(([key]) => key !== "hmac")
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join("&");
	const expected = createHmac("sha256", secret).update(values).digest();
	if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) {
		throw new HTTPException(400, { message: "Invalid store authorization" });
	}
}

export async function exchangeNativeToken(
	id: LoungeConnectorId,
	credentials: ConnectorCredentials,
	code?: string,
	signal?: AbortSignal,
) {
	const native = nativeOAuth(id, credentials.shop);
	const { clientId, clientSecret } = connectorClient(id);
	if (!native || !clientId || !clientSecret) {
		throw new HTTPException(503, {
			message: "Connector configuration is unavailable",
		});
	}
	const params = new URLSearchParams({
		client_id: clientId,
		client_secret: clientSecret,
		grant_type: code ? "authorization_code" : "refresh_token",
	});
	if (code) {
		params.set("code", code);
		params.set("redirect_uri", connectorCallback(id));
		if (credentials.verifier) {
			params.set("code_verifier", credentials.verifier);
		}
	} else if (credentials.tokens?.refresh_token) {
		params.set("refresh_token", credentials.tokens.refresh_token);
	} else {
		throw new HTTPException(409, { message: "Reconnect this connector" });
	}
	const response = await connectorFetch(native.token, {
		signal,
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body: params,
	});
	if (!response.ok) {
		throw new HTTPException(
			response.status === 400 || response.status === 401 ? 409 : 502,
			{ message: "Connector authorization failed. Try reconnecting." },
		);
	}
	const result: unknown = await response.json();
	const parsed = OAuthTokensSchema.safeParse(
		typeof result === "object" && result !== null
			? { token_type: "Bearer", ...result }
			: result,
	);
	if (!parsed.success) {
		throw new HTTPException(502, {
			message: "Connector returned invalid credentials",
		});
	}
	credentials.tokens = {
		...parsed.data,
		refresh_token:
			parsed.data.refresh_token ?? credentials.tokens?.refresh_token,
	};
	const lifetimeMs = (parsed.data.expires_in ?? 0) * 1000;
	credentials.expiresAt = lifetimeMs ? Date.now() + lifetimeMs : undefined;
}

export async function finishAuthorization(
	id: LoungeConnectorId,
	credentials: ConnectorCredentials,
	code: string,
	query: URLSearchParams,
) {
	if (id === "shopify") {
		verifyShopifyCallback(query, credentials.shop ?? "");
	}
	if (nativeOAuth(id, credentials.shop)) {
		await exchangeNativeToken(id, credentials, code);
	} else {
		const endpoint = mcpEndpoints[id];
		if (!endpoint) {
			throw new HTTPException(400, { message: "Unknown connector" });
		}
		const provider = mcpOAuthProvider(
			id,
			credentials,
			async () => {},
			() => {
				throw new HTTPException(400, {
					message: "Authorization failed. Try again.",
				});
			},
		);
		const result = await auth(provider, {
			serverUrl: endpoint,
			authorizationCode: code,
			fetchFn: connectorFetch,
		});
		if (result !== "AUTHORIZED") {
			throw new HTTPException(400, {
				message: "Authorization failed. Try again.",
			});
		}
	}
	delete credentials.verifier;
}
