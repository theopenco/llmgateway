import { expect, it } from "vitest";

import { swrWrap, waitForSwrMirrorWrites } from "@llmgateway/cache";

import { invalidateOrganizationsCache } from "./cache-helpers.js";

const offline = async (): Promise<{ credits: string }> => {
	throw new Error("database offline");
};

async function prime(id: string, credits: string) {
	for (const key of [`org:${id}`, `org:fresh:${id}`]) {
		await swrWrap(key, ["organization"], async () => ({ credits }));
	}
	await waitForSwrMirrorWrites();
}

it("never serves a dropped org row during a database outage", async () => {
	const id = `credits-${crypto.randomUUID()}`;
	await prime(id, "100");
	await invalidateOrganizationsCache([id], { dropFallback: true });
	for (const key of [`org:${id}`, `org:fresh:${id}`]) {
		await expect(swrWrap(key, ["organization"], offline)).rejects.toThrow(
			"database offline",
		);
	}
});

it("keeps the outage fallback and refreshes it on the next read", async () => {
	const id = `credits-${crypto.randomUUID()}`;
	await prime(id, "100");
	await invalidateOrganizationsCache([id]);
	for (const key of [`org:${id}`, `org:fresh:${id}`]) {
		await expect(swrWrap(key, ["organization"], offline)).resolves.toEqual({
			credits: "100",
		});
	}

	// Inside the usual mirror write throttle, the settled balance still lands.
	await prime(id, "40");
	for (const key of [`org:${id}`, `org:fresh:${id}`]) {
		await expect(swrWrap(key, ["organization"], offline)).resolves.toEqual({
			credits: "40",
		});
	}
});
