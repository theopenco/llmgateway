import { describe, expect, it } from "vitest";

import { RESPONSES_STORAGE_KEY_PREFIX } from "@/responses/tools/response-state.js";

import { redisClient } from "@llmgateway/cache";

import { clearCache } from "./test-helpers.js";

describe("clearCache", () => {
	it("drops cached state but keeps stored responses", async () => {
		const responseKey = `${RESPONSES_STORAGE_KEY_PREFIX}resp:clear-cache-spec:resp_1`;
		await redisClient.set(responseKey, "stored");
		await redisClient.set("clear-cache-spec:cached", "cached");

		await clearCache();

		expect(await redisClient.get(responseKey)).toBe("stored");
		expect(await redisClient.get("clear-cache-spec:cached")).toBeNull();

		await redisClient.del(responseKey);
	});
});
