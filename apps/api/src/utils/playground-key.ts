import { getCookie } from "hono/cookie";

import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { cdb, db, eq, tables, shortid } from "@llmgateway/db";
import {
	getApiKeyFingerprints,
	hashApiKeyForStorage,
} from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

export const PLAYGROUND_KEY_COOKIE_NAME = "llmgateway_playground_key";
const PLAYGROUND_KEY_DESCRIPTION = "Auto-generated playground key";

export async function getOrRollPlaygroundApiKey(
	projectId: string,
	userId: string,
	existingToken?: string,
): Promise<string> {
	const key = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: projectId },
			status: { eq: "active" },
			keyType: { eq: "user" },
			description: { eq: PLAYGROUND_KEY_DESCRIPTION },
		},
	});

	if (
		key &&
		existingToken &&
		(key.token === existingToken ||
			(key.tokenHash !== null &&
				getApiKeyFingerprints(existingToken).includes(key.tokenHash)))
	) {
		return existingToken;
	}

	const prefix =
		process.env.NODE_ENV === "development" ? "llmgdev_" : "llmgtwy_";
	const token = prefix + shortid(40);

	if (key) {
		await cdb
			.update(tables.apiKey)
			.set(hashApiKeyForStorage(token))
			.where(eq(tables.apiKey.id, key.id));
	} else {
		await cdb.insert(tables.apiKey).values({
			...hashApiKeyForStorage(token),
			projectId,
			description: PLAYGROUND_KEY_DESCRIPTION,
			usageLimit: null,
			createdBy: userId,
		});
	}

	return token;
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
	const cookieToken = getCookie(c, PLAYGROUND_KEY_COOKIE_NAME);
	if (cookieToken) {
		return cookieToken;
	}

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
	return await getOrRollPlaygroundApiKey(project.id, user.id);
}
