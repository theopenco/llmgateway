import { createHmac } from "node:crypto";

import { getApiKeyHashSecret } from "./api-key-hash.js";

export function getLoungeToolApprovalSecret(userId: string): string {
	return createHmac("sha256", getApiKeyHashSecret())
		.update(`lounge-tools:${userId}`)
		.digest("hex");
}
