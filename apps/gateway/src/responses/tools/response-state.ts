import { redisClient } from "@llmgateway/cache";

const RESPONSE_TTL = 86400; // 24 hours
const RESPONSE_KEY_PREFIX = "responses:";

export interface StoredResponseData {
	id: string;
	input: unknown[];
	output: unknown[];
	instructions?: string;
	model: string;
}

export async function storeResponse(
	responseId: string,
	data: StoredResponseData,
): Promise<void> {
	try {
		await redisClient.setex(
			`${RESPONSE_KEY_PREFIX}${responseId}`,
			RESPONSE_TTL,
			JSON.stringify(data),
		);
	} catch {
		// Non-critical: if Redis is unavailable, previous_response_id just won't work
	}
}

export async function getStoredResponse(
	responseId: string,
): Promise<StoredResponseData | null> {
	try {
		const data = await redisClient.get(`${RESPONSE_KEY_PREFIX}${responseId}`);
		if (!data) {
			return null;
		}
		return JSON.parse(data) as StoredResponseData;
	} catch {
		return null;
	}
}
