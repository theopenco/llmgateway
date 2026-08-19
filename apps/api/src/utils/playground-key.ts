import { getCookie, setCookie } from "hono/cookie";

import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { cdb, db, tables, shortid } from "@llmgateway/db";
import {
	getApiKeyFingerprints,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

export const PLAYGROUND_KEY_COOKIE_NAME = "llmgateway_playground_key";
const PLAYGROUND_KEY_DESCRIPTION = "Auto-generated playground key";
const PLAYGROUND_KEY_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const PLAYGROUND_KEY_TTL_MS = PLAYGROUND_KEY_COOKIE_MAX_AGE * 1000;

interface PlaygroundApiKeyResult {
	token: string;
	issued: boolean;
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
				status: { eq: "active" },
				keyType: { eq: "user" },
				description: { eq: PLAYGROUND_KEY_DESCRIPTION },
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
			return { token: existingToken, issued: false };
		}
	}

	const prefix =
		process.env.NODE_ENV === "development" ? "llmgdev_" : "llmgtwy_";
	const token = prefix + shortid(40);

	await cdb.insert(tables.apiKey).values({
		...hashApiKeyForStorage(token),
		projectId,
		description: PLAYGROUND_KEY_DESCRIPTION,
		expiresAt: new Date(Date.now() + PLAYGROUND_KEY_TTL_MS),
		usageLimit: null,
		createdBy: userId,
	});

	return { token, issued: true };
}

export function setPlaygroundKeyCookie(
	c: Context<ServerTypes>,
	token: string,
): void {
	setCookie(c, PLAYGROUND_KEY_COOKIE_NAME, token, {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		sameSite: "Lax",
		path: "/",
		maxAge: PLAYGROUND_KEY_COOKIE_MAX_AGE,
	});
}

export function getGatewayUrl() {
	const configured = process.env.GATEWAY_URL?.trim();
	if (configured) {
		// GATEWAY_URL is set both with and without the `/v1` suffix depending on
		// the environment (the frontends strip it off, every caller of this
		// helper appends `/v1` paths), so normalize to exactly one `/v1`.
		return `${configured.replace(/\/+$/, "").replace(/(\/v1)+$/, "")}/v1`;
	}
	return process.env.NODE_ENV === "development"
		? "http://localhost:4001/v1"
		: "https://api.llmgateway.io/v1";
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
	if (result.issued) {
		setPlaygroundKeyCookie(c, result.token);
	}
	return result.token;
}
