import { getCookie, setCookie } from "hono/cookie";

import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { and, asc, cdb, db, eq, sql, tables, shortid } from "@llmgateway/db";
import {
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

export { PLAYGROUND_KEY_COOKIE_MAX_AGE, PLAYGROUND_KEY_COOKIE_NAME };

export const PLAYGROUND_KEY_DESCRIPTION = "Playground";
const PLAYGROUND_KEY_TTL_MS = PLAYGROUND_KEY_COOKIE_MAX_AGE * 1000;

interface PlaygroundApiKeyResult {
	token: string;
	issued: boolean;
	cookieNeedsRefresh: boolean;
	cookieMaxAge: number;
}

// Playground keys are per (project, user): the row is provisioned lazily the
// first time that member uses the playground, and is only ever rotated for the
// member who owns it. Scoping by creator keeps teammates from revoking each
// other's key. The cookie carries the secret because storage is hash-only.
export async function getOrCreatePlaygroundApiKey(
	projectId: string,
	userId: string,
	existingToken?: string,
): Promise<PlaygroundApiKeyResult> {
	return await cdb.transaction(async (tx) => {
		await tx.execute(
			sql`SELECT ${tables.project.id} FROM ${tables.project} WHERE ${tables.project.id} = ${projectId} FOR UPDATE`,
		);

		const [key] = await tx
			.select()
			.from(tables.apiKey)
			.where(
				and(
					eq(tables.apiKey.projectId, projectId),
					eq(tables.apiKey.status, "active"),
					eq(tables.apiKey.keyType, "user"),
					eq(tables.apiKey.kind, "playground"),
					eq(tables.apiKey.createdBy, userId),
				),
			)
			.orderBy(asc(tables.apiKey.createdAt))
			.limit(1);

		const now = Date.now();
		const tokenMatches =
			key &&
			existingToken &&
			key.tokenHash !== null &&
			getApiKeyFingerprints(existingToken).includes(key.tokenHash);

		if (
			key &&
			existingToken &&
			tokenMatches &&
			(!key.expiresAt || key.expiresAt.getTime() > now)
		) {
			const expiresAt = key.expiresAt ?? new Date(now + PLAYGROUND_KEY_TTL_MS);
			const shouldUpdate =
				!key.expiresAt || key.description !== PLAYGROUND_KEY_DESCRIPTION;

			if (shouldUpdate) {
				await tx
					.update(tables.apiKey)
					.set({
						description: PLAYGROUND_KEY_DESCRIPTION,
						expiresAt,
					})
					.where(eq(tables.apiKey.id, key.id));
			}

			return {
				token: existingToken,
				issued: false,
				cookieNeedsRefresh: !key.expiresAt,
				cookieMaxAge: Math.max(
					1,
					Math.min(
						PLAYGROUND_KEY_COOKIE_MAX_AGE,
						Math.floor((expiresAt.getTime() - now) / 1000),
					),
				),
			};
		}

		const prefix =
			process.env.NODE_ENV === "development" ? "llmgdev_" : "llmgtwy_";
		const token = prefix + shortid(40);
		const expiresAt = new Date(now + PLAYGROUND_KEY_TTL_MS);

		if (key) {
			await tx
				.update(tables.apiKey)
				.set({
					...hashApiKeyForStorage(token),
					description: PLAYGROUND_KEY_DESCRIPTION,
					expiresAt,
				})
				.where(eq(tables.apiKey.id, key.id));
		} else {
			await tx.insert(tables.apiKey).values({
				...hashApiKeyForStorage(token),
				projectId,
				description: PLAYGROUND_KEY_DESCRIPTION,
				kind: "playground",
				expiresAt,
				usageLimit: null,
				createdBy: userId,
			});
		}

		return {
			token,
			issued: true,
			cookieNeedsRefresh: true,
			cookieMaxAge: PLAYGROUND_KEY_COOKIE_MAX_AGE,
		};
	});
}

export function setPlaygroundKeyCookie(
	c: Context<ServerTypes>,
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
	const result = await getOrCreatePlaygroundApiKey(
		project.id,
		user.id,
		getCookie(c, PLAYGROUND_KEY_COOKIE_NAME),
	);
	if (result.cookieNeedsRefresh) {
		setPlaygroundKeyCookie(c, result.token, result.cookieMaxAge);
	}
	return result.token;
}
