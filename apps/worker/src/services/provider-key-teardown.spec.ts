import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import {
	db,
	eq,
	PROVIDER_KEY_DELETION_GRACE_SECONDS,
	tables,
} from "@llmgateway/db";

import { tearDownPendingProviderKeys } from "./provider-key-teardown.js";

const GRACE_MS = PROVIDER_KEY_DELETION_GRACE_SECONDS * 1000;

async function createPendingKey(deletionRequestedAt: Date) {
	const id = `teardown-key-${randomUUID()}`;
	await db.insert(tables.providerKey).values({
		id,
		provider: "openai",
		...encryptProviderKeyForStorage("managed-provider-key", id, null),
		managed: true,
		status: "pending_deletion",
		deletionRequestedAt,
	});
	return id;
}

async function statusOf(id: string) {
	const [row] = await db
		.select({ status: tables.providerKey.status })
		.from(tables.providerKey)
		.where(eq(tables.providerKey.id, id));
	return row?.status;
}

describe("tearDownPendingProviderKeys", () => {
	it("deletes keys only once their grace period has passed", async () => {
		const now = new Date();
		const expired = await createPendingKey(
			new Date(now.getTime() - GRACE_MS - 1000),
		);
		const inGrace = await createPendingKey(
			new Date(now.getTime() - GRACE_MS + 60_000),
		);

		await tearDownPendingProviderKeys(now);

		expect(await statusOf(expired)).toBe("deleted");
		expect(await statusOf(inGrace)).toBe("pending_deletion");
	});
});
