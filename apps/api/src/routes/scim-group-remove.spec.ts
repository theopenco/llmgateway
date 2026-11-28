import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

const SCIM_TOKEN = "scim_remove_token_abcdef0123456789";
const ORG_ID = "scim-remove-org";

function scimHeaders() {
	return {
		Authorization: `Bearer ${SCIM_TOKEN}`,
		"Content-Type": "application/scim+json",
	};
}

describe("scim group PATCH remove", () => {
	beforeEach(async () => {
		await createTestUser();

		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "SCIM Remove Org",
			billingEmail: "scim-remove@example.com",
			plan: "enterprise",
			autoTopUpEnabled: false,
			autoTopUpThreshold: "10",
			autoTopUpAmount: "10",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.scimToken).values({
			tokenHash: getApiKeyFingerprint(SCIM_TOKEN),
			maskedToken: "scim_remo...6789",
			organizationId: ORG_ID,
			createdBy: "test-user-id",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	async function provisionUser(email: string): Promise<string> {
		const response = await app.request("/scim/v2/Users", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				userName: email,
				emails: [{ value: email, primary: true }],
				active: true,
			}),
		});
		expect(response.status).toBe(201);
		return ((await response.json()) as { id: string }).id;
	}

	async function createGroup(memberIds: string[]): Promise<string> {
		const response = await app.request("/scim/v2/Groups", {
			method: "POST",
			headers: scimHeaders(),
			body: JSON.stringify({
				displayName: "Engineers",
				members: memberIds.map((value) => ({ value })),
			}),
		});
		expect(response.status).toBe(201);
		return ((await response.json()) as { id: string }).id;
	}

	async function patchGroup(groupId: string, operation: object) {
		const response = await app.request(`/scim/v2/Groups/${groupId}`, {
			method: "PATCH",
			headers: scimHeaders(),
			body: JSON.stringify({
				schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
				Operations: [operation],
			}),
		});
		expect(response.status).toBeLessThan(300);
	}

	async function memberIds(groupId: string): Promise<string[]> {
		const rows = await db.query.scimGroupMember.findMany({
			where: { scimGroupId: { eq: groupId } },
			columns: { userId: true },
		});
		return rows.map((r) => r.userId).sort();
	}

	test("a value-list remove (Entra) removes only the listed members", async () => {
		const alice = await provisionUser("alice-remove@example.com");
		const bob = await provisionUser("bob-remove@example.com");
		const groupId = await createGroup([alice, bob]);

		await patchGroup(groupId, {
			op: "Remove",
			path: "members",
			value: [{ value: alice }],
		});

		expect(await memberIds(groupId)).toEqual([bob]);
	});

	test("a filter remove (Okta) removes only the matched member", async () => {
		const alice = await provisionUser("alice-filter@example.com");
		const bob = await provisionUser("bob-filter@example.com");
		const groupId = await createGroup([alice, bob]);

		await patchGroup(groupId, {
			op: "remove",
			path: `members[value eq "${bob}"]`,
		});

		expect(await memberIds(groupId)).toEqual([alice]);
	});

	test("a valueless remove clears the group", async () => {
		const alice = await provisionUser("alice-clear@example.com");
		const bob = await provisionUser("bob-clear@example.com");
		const groupId = await createGroup([alice, bob]);

		await patchGroup(groupId, { op: "remove", path: "members" });

		expect(await memberIds(groupId)).toEqual([]);
	});
});
