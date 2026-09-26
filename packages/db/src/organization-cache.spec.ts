import { expect, it } from "vitest";

import { swrWrap, waitForSwrMirrorWrites } from "@llmgateway/cache";

import { invalidateOrganizationsCache } from "./cache-helpers.js";

it("never serves an invalidated credit balance during a database outage", async () => {
	const id = `credits-${crypto.randomUUID()}`;
	for (const key of [`org:${id}`, `org:fresh:${id}`]) {
		await swrWrap(key, ["organization"], async () => ({ credits: "100" }));
	}
	await waitForSwrMirrorWrites();
	await invalidateOrganizationsCache([id]);
	for (const key of [`org:${id}`, `org:fresh:${id}`]) {
		await expect(
			swrWrap(key, ["organization"], async () => {
				throw new Error("database offline");
			}),
		).rejects.toThrow("database offline");
	}
});
