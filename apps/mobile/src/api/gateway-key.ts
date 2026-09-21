import { PLAYGROUND_KEY_COOKIE_NAME } from "@llmgateway/shared/playground-key-cookie";

import { client } from "./client";

const keys = new Map<string, string>();
const pending = new Map<string, Promise<string>>();
let sessionVersion = 0;

export function clearGatewayKey() {
	sessionVersion++;
	keys.clear();
	pending.clear();
}

export async function ensureGatewayKey(projectId: string): Promise<string> {
	const existing = pending.get(projectId);
	if (existing) {
		return await existing;
	}
	const version = sessionVersion;
	const token = keys.get(projectId);
	// Validate each time: another device can rotate this user's project key.
	const request = client
		.POST("/playground/ensure-key", {
			body: { projectId },
			headers: token
				? {
						Cookie: `${PLAYGROUND_KEY_COOKIE_NAME}=${encodeURIComponent(token)}`,
					}
				: undefined,
		})
		.then(({ data }) => {
			if (version !== sessionVersion) {
				throw new Error("Your session changed. Please try again.");
			}
			if (!data) {
				throw new Error("Could not prepare your Lounge session.");
			}
			keys.set(projectId, data.token);
			return data.token;
		});
	pending.set(projectId, request);
	try {
		return await request;
	} finally {
		if (pending.get(projectId) === request) {
			pending.delete(projectId);
		}
	}
}
