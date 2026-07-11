import { getCookie } from "hono/cookie";

import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { db, tables, shortid } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";
import type { Context } from "hono";

export const PLAYGROUND_KEY_COOKIE_NAME = "llmgateway_playground_key";

export function getGatewayUrl() {
	return (
		process.env.GATEWAY_URL ??
		(process.env.NODE_ENV === "development"
			? "http://localhost:4001/v1"
			: "https://api.llmgateway.io/v1")
	);
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
	let key = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: project.id },
			status: { eq: "active" },
		},
	});
	if (!key) {
		const prefix =
			process.env.NODE_ENV === "development" ? "llmgdev_" : "llmgtwy_";
		[key] = await db
			.insert(tables.apiKey)
			.values({
				token: prefix + shortid(40),
				projectId: project.id,
				description: "Auto-generated playground key",
				usageLimit: null,
				createdBy: user.id,
			})
			.returning();
	}
	return key.token;
}
