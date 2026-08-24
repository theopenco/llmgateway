import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { cdb, db, eq, tables, shortid } from "@llmgateway/db";
import {
	getPlaygroundKeyCookieName,
	getPlaygroundKeyCookieNamesToRemove,
	PLAYGROUND_KEY_COOKIE_MAX_AGE,
	PLAYGROUND_KEY_COOKIE_NAME,
} from "@llmgateway/shared";
import {
	getApiKeyFingerprints,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";
import { getGatewayApiBaseUrl } from "@llmgateway/shared/gateway-url";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

export {
	getPlaygroundKeyCookieName,
	PLAYGROUND_KEY_COOKIE_MAX_AGE,
	PLAYGROUND_KEY_COOKIE_NAME,
};

export const PLAYGROUND_KEY_DESCRIPTION = "Auto-generated playground key";
const PLAYGROUND_KEY_TTL_MS = PLAYGROUND_KEY_COOKIE_MAX_AGE * 1000;

interface PlaygroundApiKeyResult {
	token: string;
	issued: boolean;
	cookieNeedsRefresh: boolean;
	cookieMaxAge: number;
}

export async function getOrCreatePlaygroundApiKey(
	projectId: string,
	userId: string,
	existingToken?: string,
): Promise<PlaygroundApiKeyResult> {
	if (existingToken) {
		const matchingKey = await db.query.apiKey.findFirst({
			where: {
				projectId: { eq: projectId },
				createdBy: { eq: userId },
				status: { eq: "active" },
				keyType: { eq: "user" },
				kind: { eq: "playground" },
				OR: [
					{ token: { eq: existingToken } },
					{ tokenHash: { in: getApiKeyFingerprints(existingToken) } },
				],
			},
		});

		if (
			matchingKey &&
			(!matchingKey.expiresAt || matchingKey.expiresAt.getTime() > Date.now())
		) {
			const isLegacyKey = matchingKey.token !== null;
			const expiresAt =
				matchingKey.expiresAt ?? new Date(Date.now() + PLAYGROUND_KEY_TTL_MS);
			if (isLegacyKey || !matchingKey.expiresAt) {
				await cdb
					.update(tables.apiKey)
					.set({
						...(isLegacyKey ? hashApiKeyForStorage(existingToken) : {}),
						expiresAt,
					})
					.where(eq(tables.apiKey.id, matchingKey.id));
			}

			return {
				token: existingToken,
				issued: false,
				cookieNeedsRefresh: isLegacyKey || !matchingKey.expiresAt,
				cookieMaxAge: Math.max(
					1,
					Math.min(
						PLAYGROUND_KEY_COOKIE_MAX_AGE,
						Math.floor((expiresAt.getTime() - Date.now()) / 1000),
					),
				),
			};
		}
	}

	const prefix =
		process.env.NODE_ENV === "development" ? "llmgdev_" : "llmgtwy_";
	const token = prefix + shortid(40);

	await cdb.insert(tables.apiKey).values({
		...hashApiKeyForStorage(token),
		projectId,
		description: PLAYGROUND_KEY_DESCRIPTION,
		kind: "playground",
		expiresAt: new Date(Date.now() + PLAYGROUND_KEY_TTL_MS),
		usageLimit: null,
		createdBy: userId,
	});

	return {
		token,
		issued: true,
		cookieNeedsRefresh: true,
		cookieMaxAge: PLAYGROUND_KEY_COOKIE_MAX_AGE,
	};
}

export function setPlaygroundKeyCookie(
	c: Context<ServerTypes>,
	projectId: string,
	token: string,
	maxAge: number,
): void {
	const options = {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
		maxAge,
	} as const;

	for (const name of getPlaygroundKeyCookieNamesToRemove(
		Object.keys(getCookie(c)),
		projectId,
	)) {
		deleteCookie(c, name, { path: "/" });
	}
	setCookie(c, getPlaygroundKeyCookieName(projectId), token, options);
	setCookie(c, PLAYGROUND_KEY_COOKIE_NAME, token, options);
}

export function getGatewayUrl() {
	return getGatewayApiBaseUrl();
}

interface PlaygroundKeyUser {
	id: string;
	email: string;
}

// Resolve a gateway API key for server-side playground requests: the
// playground key cookie when present, otherwise the user's Chat org default
// project key (created on demand), mirroring /playground/ensure-key.
export async function resolvePlaygroundToken(
	c: Context<ServerTypes>,
	user: PlaygroundKeyUser,
): Promise<string> {
	const chatOrg = await getOrCreateChatOrg(user);
	let project = await db.query.project.findFirst({
		where: {
			organizationId: { eq: chatOrg.id },
			status: { eq: "active" },
		},
	});
	if (!project) {
		[project] = await db
			.insert(tables.project)
			.values({
				name: "Default Project",
				organizationId: chatOrg.id,
				mode: "credits",
			})
			.returning();
	}
	const scopedToken = getCookie(c, getPlaygroundKeyCookieName(project.id));
	const result = await getOrCreatePlaygroundApiKey(
		project.id,
		user.id,
		scopedToken ?? getCookie(c, PLAYGROUND_KEY_COOKIE_NAME),
	);
	if (result.cookieNeedsRefresh || !scopedToken) {
		setPlaygroundKeyCookie(c, project.id, result.token, result.cookieMaxAge);
	}
	return result.token;
}
