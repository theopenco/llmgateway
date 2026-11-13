import {
	createCipheriv,
	createDecipheriv,
	createHash,
	createHmac,
	hkdfSync,
	randomBytes,
} from "node:crypto";

import { z } from "zod";

import { findApiKeyByToken } from "@/lib/cached-queries.js";

import { redisClient } from "@llmgateway/cache";
import { getApiKeyHashSecret } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";

/**
 * OAuth 2.0 for MCP clients.
 *
 * A client registers with an LLM Gateway API key and receives a random
 * client_id and client_secret. Codes, access tokens and refresh tokens are
 * random opaque values; the API key never leaves the server. State lives in
 * Redis under HMAC-derived names, and the API key is stored only sealed with a
 * key derived from the credential that unlocks it (client secret, access token
 * or refresh token), so a Redis read alone cannot recover it. Every use
 * re-validates the API key, so rotating or deleting it revokes all grants.
 */

const SCOPE = "mcp:tools mcp:resources mcp:prompts";
const MINUTE_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * MINUTE_SECONDS;
const CODE_TTL_SECONDS = 10 * MINUTE_SECONDS;
const ACCESS_TOKEN_TTL_SECONDS = 60 * MINUTE_SECONDS;
const REFRESH_TOKEN_TTL_SECONDS = 30 * DAY_SECONDS;
const CLIENT_TTL_SECONDS = 30 * DAY_SECONDS;

const ACCESS_TOKEN_PREFIX = "mcp_at_";
const REFRESH_TOKEN_PREFIX = "mcp_rt_";
const CLIENT_ID_PREFIX = "mcp_client_";
const CLIENT_SECRET_PREFIX = "mcp_cs_";
const SEAL_INFO = "llmgateway-mcp-oauth-seal-v1";

type StateKind = "client" | "code" | "access" | "refresh";

const clientRecordSchema = z.object({
	clientName: z.string(),
	redirectUris: z.array(z.string()),
	sealedApiKey: z.string(),
});
const codeRecordSchema = z.object({
	clientId: z.string(),
	codeChallenge: z.string(),
	redirectUri: z.string(),
});
const refreshRecordSchema = z.object({
	clientId: z.string(),
	sealedApiKey: z.string(),
});

type ClientRecord = z.infer<typeof clientRecordSchema>;

function stateKey(kind: StateKind, value: string): string {
	const digest = createHmac("sha256", getApiKeyHashSecret())
		.update(`mcp-oauth:${kind}:${value}`)
		.digest("hex");
	return `mcp-oauth:${kind}:${digest}`;
}

function newCredential(prefix: string): string {
	return `${prefix}${randomBytes(32).toString("base64url")}`;
}

function sealingKey(credential: string): Buffer {
	return Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(credential, "utf8"),
			Buffer.from(getApiKeyHashSecret(), "utf8"),
			Buffer.from(SEAL_INFO, "utf8"),
			32,
		),
	);
}

function seal(apiKey: string, credential: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", sealingKey(credential), iv);
	const ciphertext = Buffer.concat([
		cipher.update(apiKey, "utf8"),
		cipher.final(),
	]);
	return [iv, cipher.getAuthTag(), ciphertext]
		.map((part) => part.toString("base64url"))
		.join(".");
}

/** The sealed API key, or null when the credential does not unlock it. */
function unseal(sealed: string, credential: string): string | null {
	const [iv, tag, ciphertext] = sealed
		.split(".")
		.map((part) => Buffer.from(part, "base64url"));
	if (!iv || !tag || !ciphertext) {
		return null;
	}
	const decipher = createDecipheriv("aes-256-gcm", sealingKey(credential), iv);
	decipher.setAuthTag(tag);
	try {
		return Buffer.concat([
			decipher.update(ciphertext),
			decipher.final(),
		]).toString("utf8");
	} catch {
		// GCM authentication failed: wrong credential.
		return null;
	}
}

async function readRecord<T>(
	key: string,
	schema: z.ZodType<T>,
	consume = false,
): Promise<T | null> {
	const raw = consume
		? await redisClient.getdel(key)
		: await redisClient.get(key);
	return raw === null ? null : schema.parse(JSON.parse(raw));
}

async function isUsableApiKey(apiKey: string): Promise<boolean> {
	const record = await findApiKeyByToken(apiKey);
	return Boolean(
		record &&
		record.status === "active" &&
		!(
			record.keyType === "user" &&
			record.expiresAt &&
			record.expiresAt <= new Date()
		),
	);
}

/**
 * The API key a bearer credential stands for: an OAuth access token resolves
 * through its server-side grant, anything else is taken as the API key itself.
 * Null when an access token is unknown, expired or revoked.
 */
export async function resolveMcpBearerToken(
	token: string,
): Promise<string | null> {
	if (!token.startsWith(ACCESS_TOKEN_PREFIX)) {
		return token;
	}
	const sealed = await redisClient.get(stateKey("access", token));
	return sealed === null ? null : unseal(sealed, token);
}

function isLoopbackHost(hostname: string): boolean {
	return (
		hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "localhost"
	);
}

/**
 * Loopback redirect URIs may use any port (RFC 8252 §7.3); everything else
 * must match a registered URI exactly.
 */
function isValidRedirectUri(
	redirectUri: string,
	registeredUris: string[],
): boolean {
	if (!URL.canParse(redirectUri)) {
		return false;
	}
	const parsedUri = new URL(redirectUri);
	if (isLoopbackHost(parsedUri.hostname) && parsedUri.protocol === "http:") {
		const loopbackMatch = registeredUris.some((registered) => {
			if (!URL.canParse(registered)) {
				return false;
			}
			const parsedRegistered = new URL(registered);
			return (
				isLoopbackHost(parsedRegistered.hostname) &&
				parsedRegistered.protocol === parsedUri.protocol &&
				parsedRegistered.pathname === parsedUri.pathname
			);
		});
		if (loopbackMatch) {
			return true;
		}
	}
	return registeredUris.includes(redirectUri);
}

function pkceChallenge(codeVerifier: string): string {
	return createHash("sha256").update(codeVerifier).digest("base64url");
}

/**
 * Base URL of this deployment as the client sees it. TLS terminates at the
 * load balancer, so `c.req.url` reports `http:` in production — trust
 * `x-forwarded-proto` when present or the published metadata advertises
 * plain-http endpoints.
 */
export function resolveRequestBaseUrl(c: Context): string {
	const url = new URL(c.req.url);
	// x-forwarded-proto may be a comma-separated chain when multiple proxies
	// are involved; only the first (client-facing) value is meaningful, and
	// anything but http/https would produce an invalid URL.
	const forwarded = (c.req.header("x-forwarded-proto") ?? "")
		.split(",")[0]!
		.trim()
		.toLowerCase();
	const proto =
		forwarded === "http" || forwarded === "https"
			? forwarded
			: url.protocol.slice(0, -1);
	return `${proto}://${url.host}`;
}

/** OAuth 2.0 Authorization Server Metadata (RFC 8414). */
function oauthMetadataHandler(c: Context): Response {
	const baseUrl = resolveRequestBaseUrl(c);
	return c.json({
		issuer: baseUrl,
		authorization_endpoint: `${baseUrl}/oauth/authorize`,
		token_endpoint: `${baseUrl}/oauth/token`,
		registration_endpoint: `${baseUrl}/oauth/register`,
		revocation_endpoint: `${baseUrl}/oauth/revoke`,
		response_types_supported: ["code"],
		grant_types_supported: [
			"authorization_code",
			"client_credentials",
			"refresh_token",
		],
		code_challenge_methods_supported: ["S256"],
		token_endpoint_auth_methods_supported: [
			"client_secret_basic",
			"client_secret_post",
		],
		scopes_supported: SCOPE.split(" "),
	});
}

/** OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint. */
function protectedResourceMetadataHandler(c: Context): Response {
	const baseUrl = resolveRequestBaseUrl(c);
	return c.json({
		resource: `${baseUrl}/mcp`,
		authorization_servers: [baseUrl],
		scopes_supported: SCOPE.split(" "),
		bearer_methods_supported: ["header"],
		resource_name: "LLM Gateway MCP server",
		resource_documentation: "https://llmgateway.io/mcp",
	});
}

function oauthError(
	c: Context,
	error: string,
	description: string,
	status: 400 | 401 = 400,
): Response {
	c.header("Cache-Control", "no-store");
	return c.json({ error, error_description: description }, status);
}

async function oauthAuthorizeHandler(c: Context): Promise<Response> {
	const clientId = c.req.query("client_id");
	const redirectUri = c.req.query("redirect_uri");
	const state = c.req.query("state");

	if (!clientId || !redirectUri) {
		return oauthError(
			c,
			"invalid_request",
			"Missing client_id or redirect_uri",
		);
	}

	// Validate the redirect before anything is sent to it.
	const client = await readRecord(
		stateKey("client", clientId),
		clientRecordSchema,
	);
	if (!client) {
		return oauthError(
			c,
			"invalid_client",
			"Client not registered. Please register the client first via /oauth/register",
			401,
		);
	}
	if (!isValidRedirectUri(redirectUri, client.redirectUris)) {
		return oauthError(
			c,
			"invalid_redirect_uri",
			"The redirect_uri does not match any registered redirect URI for this client",
		);
	}

	const redirectUrl = new URL(redirectUri);
	if (state) {
		redirectUrl.searchParams.set("state", state);
	}

	const codeChallenge = c.req.query("code_challenge");
	if (!codeChallenge || c.req.query("code_challenge_method") !== "S256") {
		redirectUrl.searchParams.set("error", "invalid_request");
		redirectUrl.searchParams.set(
			"error_description",
			"PKCE with code_challenge_method S256 is required",
		);
		return c.redirect(redirectUrl.toString(), 302);
	}

	const code = newCredential("");
	await redisClient.set(
		stateKey("code", code),
		JSON.stringify({ clientId, codeChallenge, redirectUri }),
		"EX",
		CODE_TTL_SECONDS,
	);

	redirectUrl.searchParams.set("code", code);
	return c.redirect(redirectUrl.toString(), 302);
}

async function readParams(c: Context): Promise<Record<string, string>> {
	const contentType = c.req.header("Content-Type") ?? "";
	let raw: Record<string, unknown> = {};
	if (contentType.includes("application/x-www-form-urlencoded")) {
		raw = await c.req.parseBody();
	} else if (contentType.includes("application/json")) {
		let body: unknown = null;
		try {
			body = await c.req.json<unknown>();
		} catch (error) {
			// Malformed JSON carries no parameters; the grant checks reject it.
			if (!(error instanceof SyntaxError)) {
				throw error;
			}
		}
		const parsed = z.record(z.string(), z.unknown()).safeParse(body);
		raw = parsed.success ? parsed.data : {};
	}
	return Object.fromEntries(
		Object.entries(raw).filter(
			(entry): entry is [string, string] => typeof entry[1] === "string",
		),
	);
}

/**
 * Client credentials from HTTP Basic (RFC 6749 §2.3.1) or the request body.
 */
function readClientCredentials(
	c: Context,
	params: Record<string, string>,
): { clientId?: string; clientSecret?: string } {
	const authHeader = c.req.header("Authorization");
	if (authHeader?.startsWith("Basic ")) {
		const decoded = Buffer.from(authHeader.slice(6), "base64").toString();
		const separator = decoded.indexOf(":");
		if (separator > 0) {
			return {
				clientId: decodeURIComponent(decoded.slice(0, separator)),
				clientSecret: decodeURIComponent(decoded.slice(separator + 1)),
			};
		}
	}
	return { clientId: params.client_id, clientSecret: params.client_secret };
}

/** The client's API key when its credentials are valid, else null. */
async function authenticateClient(
	clientId: string | undefined,
	clientSecret: string | undefined,
): Promise<{ client: ClientRecord; apiKey: string } | null> {
	if (!clientId || !clientSecret) {
		return null;
	}
	const client = await readRecord(
		stateKey("client", clientId),
		clientRecordSchema,
	);
	const apiKey = client ? unseal(client.sealedApiKey, clientSecret) : null;
	return client && apiKey ? { client, apiKey } : null;
}

async function issueTokens(
	c: Context,
	clientId: string,
	apiKey: string,
	withRefreshToken: boolean,
): Promise<Response> {
	const accessToken = newCredential(ACCESS_TOKEN_PREFIX);
	await redisClient.set(
		stateKey("access", accessToken),
		seal(apiKey, accessToken),
		"EX",
		ACCESS_TOKEN_TTL_SECONDS,
	);
	let refreshToken: string | undefined;
	if (withRefreshToken) {
		refreshToken = newCredential(REFRESH_TOKEN_PREFIX);
		await redisClient.set(
			stateKey("refresh", refreshToken),
			JSON.stringify({ clientId, sealedApiKey: seal(apiKey, refreshToken) }),
			"EX",
			REFRESH_TOKEN_TTL_SECONDS,
		);
	}
	c.header("Cache-Control", "no-store");
	return c.json({
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: ACCESS_TOKEN_TTL_SECONDS,
		scope: SCOPE,
		...(refreshToken ? { refresh_token: refreshToken } : {}),
	});
}

async function oauthTokenHandler(c: Context): Promise<Response> {
	const params = await readParams(c);
	const grantType = params.grant_type;
	if (!grantType) {
		return oauthError(c, "invalid_request", "Missing grant_type");
	}
	if (
		grantType !== "authorization_code" &&
		grantType !== "refresh_token" &&
		grantType !== "client_credentials"
	) {
		return oauthError(
			c,
			"unsupported_grant_type",
			`Grant type '${grantType}' is not supported`,
		);
	}

	if (grantType === "authorization_code") {
		if (!params.code) {
			return oauthError(c, "invalid_request", "Missing authorization code");
		}
		if (!params.code_verifier) {
			return oauthError(c, "invalid_request", "Missing code_verifier");
		}
	}
	if (grantType === "refresh_token" && !params.refresh_token) {
		return oauthError(c, "invalid_request", "Missing refresh_token");
	}

	const { clientId, clientSecret } = readClientCredentials(c, params);
	const authenticated = await authenticateClient(clientId, clientSecret);
	if (!clientId || !authenticated) {
		return oauthError(c, "invalid_client", "Invalid client credentials", 401);
	}

	let apiKey = authenticated.apiKey;
	if (grantType === "authorization_code") {
		// Single use: the code is gone whether or not the exchange succeeds.
		const code = await readRecord(
			stateKey("code", params.code!),
			codeRecordSchema,
			true,
		);
		if (
			!code ||
			code.clientId !== clientId ||
			(params.redirect_uri !== undefined &&
				params.redirect_uri !== code.redirectUri) ||
			pkceChallenge(params.code_verifier!) !== code.codeChallenge
		) {
			return oauthError(
				c,
				"invalid_grant",
				"Invalid or expired authorization code",
			);
		}
	} else if (grantType === "refresh_token") {
		// Rotated on every use.
		const refreshToken = params.refresh_token!;
		const record = await readRecord(
			stateKey("refresh", refreshToken),
			refreshRecordSchema,
			true,
		);
		const refreshedKey =
			record?.clientId === clientId
				? unseal(record.sealedApiKey, refreshToken)
				: null;
		if (!refreshedKey) {
			return oauthError(c, "invalid_grant", "Invalid or expired refresh token");
		}
		apiKey = refreshedKey;
	}

	if (!(await isUsableApiKey(apiKey))) {
		return oauthError(
			c,
			"invalid_grant",
			"The API key behind this client is no longer active",
		);
	}

	return await issueTokens(
		c,
		clientId,
		apiKey,
		grantType !== "client_credentials",
	);
}

/** Token revocation (RFC 7009): holding a token is enough to revoke it. */
async function oauthRevokeHandler(c: Context): Promise<Response> {
	const { token } = await readParams(c);
	if (!token) {
		return oauthError(c, "invalid_request", "Missing token");
	}
	await redisClient.del(stateKey("access", token), stateKey("refresh", token));
	return c.body(null, 200);
}

/**
 * Dynamic client registration (RFC 7591). The caller proves it holds an
 * active API key; the response carries only random client credentials.
 */
async function oauthRegisterHandler(c: Context): Promise<Response> {
	const schema = z.object({
		client_name: z.string().nullish(),
		redirect_uris: z.unknown(),
		api_key: z.string().nullish(),
	});
	let body: z.infer<typeof schema>;
	try {
		body = schema.parse(await c.req.json<unknown>());
	} catch (error) {
		if (!(error instanceof SyntaxError) && !(error instanceof z.ZodError)) {
			throw error;
		}
		return oauthError(c, "invalid_request", "Invalid request body");
	}

	const authHeader = c.req.header("Authorization");
	const apiKey =
		body.api_key ??
		(authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);
	if (!apiKey) {
		return oauthError(
			c,
			"invalid_request",
			"API key required. Provide your LLM Gateway API key in the request body as 'api_key' or in Authorization header.",
		);
	}
	if (!(await isUsableApiKey(apiKey))) {
		return oauthError(
			c,
			"invalid_client_metadata",
			"Invalid or inactive LLM Gateway API key",
			401,
		);
	}

	// http only for loopback, https for everything else.
	const redirectUris = (
		Array.isArray(body.redirect_uris) ? body.redirect_uris : []
	).filter((uri): uri is string => {
		if (typeof uri !== "string" || !URL.canParse(uri)) {
			return false;
		}
		const parsed = new URL(uri);
		return (
			parsed.protocol === "https:" ||
			(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))
		);
	});

	const clientName = body.client_name ?? "mcp-client";
	const clientId = newCredential(CLIENT_ID_PREFIX);
	const clientSecret = newCredential(CLIENT_SECRET_PREFIX);
	const record: ClientRecord = {
		clientName,
		redirectUris,
		sealedApiKey: seal(apiKey, clientSecret),
	};
	await redisClient.set(
		stateKey("client", clientId),
		JSON.stringify(record),
		"EX",
		CLIENT_TTL_SECONDS,
	);

	const issuedAt = Math.floor(Date.now() / 1000);
	c.header("Cache-Control", "no-store");
	return c.json(
		{
			client_id: clientId,
			client_secret: clientSecret,
			client_id_issued_at: issuedAt,
			client_secret_expires_at: issuedAt + CLIENT_TTL_SECONDS,
			client_name: clientName,
			redirect_uris: redirectUris,
			grant_types: [
				"authorization_code",
				"refresh_token",
				"client_credentials",
			],
			response_types: ["code"],
			token_endpoint_auth_method: "client_secret_basic",
		},
		201,
	);
}

/** Deletes a registration, authenticated with its client credentials. */
async function oauthDeleteClientHandler(c: Context): Promise<Response> {
	const clientId = c.req.param("client_id");
	const { clientId: authClientId, clientSecret } = readClientCredentials(c, {});
	if (
		!clientId ||
		authClientId !== clientId ||
		!(await authenticateClient(clientId, clientSecret))
	) {
		return oauthError(c, "invalid_client", "Invalid client credentials", 401);
	}
	await redisClient.del(stateKey("client", clientId));
	return c.body(null, 204);
}

/** Registers the OAuth endpoints MCP clients use to authenticate. */
export function registerMcpOAuthRoutes(app: OpenAPIHono<ServerTypes>): void {
	app.get("/.well-known/oauth-authorization-server", oauthMetadataHandler);
	app.get("/.well-known/oauth-authorization-server/mcp", oauthMetadataHandler);
	app.get(
		"/.well-known/oauth-protected-resource",
		protectedResourceMetadataHandler,
	);
	app.get(
		"/.well-known/oauth-protected-resource/mcp",
		protectedResourceMetadataHandler,
	);

	app.get("/oauth/authorize", oauthAuthorizeHandler);
	app.post("/oauth/token", oauthTokenHandler);
	app.post("/oauth/revoke", oauthRevokeHandler);
	app.post("/oauth/register", oauthRegisterHandler);
	app.delete("/oauth/register/:client_id", oauthDeleteClientHandler);
}
