import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { redisClient } from "@/auth/config.js";
import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

interface SharedSnapshot {
	id: string;
	allowDiscovery: boolean;
	allowForking: boolean;
	messages: Array<{ content: string }>;
}

describe("chat sharing permissions", () => {
	let token: string;
	let chatId: string;

	beforeEach(async () => {
		// The public share endpoints are rate limited per IP and every request
		// here shares one address, so clear the windows between tests.
		const keys = await redisClient.keys("chat_share_rate_limit:*");
		if (keys.length > 0) {
			await redisClient.del(...keys);
		}
		token = await createTestUser();
		const [chat] = await db
			.insert(tables.chat)
			.values({
				userId: "test-user-id",
				title: "Test conversation",
				model: "gpt-4o-mini",
			})
			.returning();
		chatId = chat.id;
		await db.insert(tables.message).values({
			chatId,
			role: "user",
			content: "A conversation shared with consent",
			sequence: 0,
		});
	});

	afterEach(deleteAll);

	function createShare(body: Record<string, unknown>) {
		return app.request(`/chats/${chatId}/share`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify(body),
		});
	}

	async function share(body: Record<string, unknown> = {}) {
		const response = await createShare({ visibility: "public", ...body });
		expect(response.status).toBe(200);
		const data = (await response.json()) as { share: { id: string } };
		return data.share.id;
	}

	function fork(shareId: string, cookie = token) {
		return app.request(`/chats/share/${shareId}/fork`, {
			method: "POST",
			headers: { Cookie: cookie },
		});
	}

	async function viewerToken() {
		const account = await db.query.account.findFirst({
			where: { userId: "test-user-id" },
		});
		await db.insert(tables.user).values({
			id: "other-user-id",
			name: "Other User",
			email: "other@example.com",
			emailVerified: true,
		});
		await db.insert(tables.account).values({
			id: "other-account-id",
			accountId: "other-account-id",
			providerId: "credential",
			userId: "other-user-id",
			password: account!.password,
		});
		const response = await app.request("/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "other@example.com",
				password: "admin@example.com1A",
			}),
		});
		expect(response.status).toBe(200);
		return response.headers.get("set-cookie")!;
	}

	async function organization() {
		await db.insert(tables.organization).values({
			id: "share-org",
			name: "Test Organization",
			billingEmail: "admin@example.com",
		});
		await db
			.insert(tables.userOrganization)
			.values({ organizationId: "share-org", userId: "test-user-id" });
	}

	test("rejects a missing request body", async () => {
		const response = await app.request(`/chats/${chatId}/share`, {
			method: "POST",
			headers: { Cookie: token },
		});
		expect(response.status).toBe(400);
		expect(await db.query.chatShare.findMany()).toHaveLength(0);
	});

	test.each([false, true])(
		"retries preserve existing consent: %s",
		async (consent) => {
			const shareId = await share({
				allowDiscovery: consent,
				allowForking: consent,
			});
			const response = await createShare({
				visibility: "public",
				allowDiscovery: !consent,
				allowForking: !consent,
			});
			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({
				share: { id: shareId, allowDiscovery: consent, allowForking: consent },
			});
			const snapshot = await db.query.chatShare.findFirst({
				where: { id: shareId },
			});
			expect(snapshot).toMatchObject({
				allowDiscovery: consent,
				allowForking: consent,
			});
		},
	);

	test.each([
		{},
		{ organizationId: "share-org" },
		{ visibility: "organization" },
		{ visibility: "public", organizationId: "share-org" },
		{
			visibility: "organization",
			organizationId: "share-org",
			allowDiscovery: true,
		},
	])("rejects missing or contradictory audience: %j", async (body) => {
		expect((await createShare(body)).status).toBe(400);
		expect(await db.query.chatShare.findMany()).toHaveLength(0);
	});

	test("public links stay readable, unlisted, and non-forkable by default", async () => {
		const shareId = await share();
		const response = await app.request(`/public/chats/share/${shareId}`);
		expect(response.status).toBe(200);
		expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
		const data = (await response.json()) as { share: SharedSnapshot };
		expect(data.share).toMatchObject({
			allowDiscovery: false,
			allowForking: false,
		});
		expect(data.share.messages[0].content).toBe(
			"A conversation shared with consent",
		);
		const listing = await app.request("/public/chats/share");
		expect(await listing.json()).toEqual({ shares: [] });
		expect((await fork(shareId, await viewerToken())).status).toBe(403);
		expect(
			await db.query.chat.findMany({ where: { userId: "other-user-id" } }),
		).toHaveLength(0);
	});

	test("database defaults keep shares without consent unlisted and non-forkable", async () => {
		const [snapshot] = await db
			.insert(tables.chatShare)
			.values({
				chatId,
				userId: "test-user-id",
				title: "Legacy snapshot",
				model: "gpt-4o-mini",
				messages: [],
			})
			.returning();
		expect(snapshot.allowDiscovery).toBe(false);
		expect(snapshot.allowForking).toBe(false);
		expect((await fork(snapshot.id)).status).toBe(403);
		expect(await (await app.request("/public/chats/share")).json()).toEqual({
			shares: [],
		});
	});

	test("discovery opt-in lists the share without enabling forks", async () => {
		const shareId = await share({ allowDiscovery: true });
		const listing = (await (
			await app.request("/public/chats/share")
		).json()) as { shares: Array<{ id: string }> };
		expect(listing.shares.map((item) => item.id)).toEqual([shareId]);
		expect(
			(await app.request(`/public/chats/share/${shareId}`)).headers.get(
				"X-Robots-Tag",
			),
		).toBe("index, follow");
		expect((await fork(shareId)).status).toBe(403);
	});

	test("fork consent allows an independent copy without enabling discovery", async () => {
		const shareId = await share({ allowForking: true });
		const viewer = await viewerToken();
		const response = await fork(shareId, viewer);
		expect(response.status).toBe(201);
		const { chat } = (await response.json()) as { chat: { id: string } };
		expect(await (await app.request("/public/chats/share")).json()).toEqual({
			shares: [],
		});
		await app.request(`/chats/${chatId}/share`, {
			method: "DELETE",
			headers: { Cookie: token },
		});
		expect((await fork(shareId, viewer)).status).toBe(404);
		expect((await app.request(`/public/chats/share/${shareId}`)).status).toBe(
			404,
		);
		await db.delete(tables.chat).where(eq(tables.chat.id, chatId));
		expect(
			await db.query.message.findMany({ where: { chatId: chat.id } }),
		).toMatchObject([{ content: "A conversation shared with consent" }]);
	});

	test("organization shares require membership for reading and opted-in forks", async () => {
		await organization();
		const shareId = await share({
			visibility: "organization",
			organizationId: "share-org",
			allowForking: true,
		});
		const viewer = await viewerToken();
		expect((await app.request(`/public/chats/share/${shareId}`)).status).toBe(
			404,
		);
		expect((await app.request(`/chats/org-share/${shareId}`)).status).toBe(401);
		expect(
			(
				await app.request(`/chats/org-share/${shareId}`, {
					headers: { Cookie: viewer },
				})
			).status,
		).toBe(404);
		expect((await fork(shareId, viewer)).status).toBe(404);
		expect(
			(
				await app.request(`/chats/org-share/${shareId}`, {
					headers: { Cookie: token },
				})
			).status,
		).toBe(200);
		expect((await fork(shareId)).status).toBe(201);
		expect(await (await app.request("/public/chats/share")).json()).toEqual({
			shares: [],
		});
	});

	test("organization shares deny member forks without consent", async () => {
		await organization();
		const shareId = await share({
			visibility: "organization",
			organizationId: "share-org",
		});
		expect((await fork(shareId)).status).toBe(403);
	});

	test("only the owner can create a share", async () => {
		const viewer = await viewerToken();
		const response = await app.request(`/chats/${chatId}/share`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: viewer },
			body: JSON.stringify({
				visibility: "public",
				allowForking: true,
				allowDiscovery: true,
			}),
		});
		expect(response.status).toBe(404);
		expect(await db.query.chatShare.findMany()).toHaveLength(0);
	});

	test("archived originals disappear from discovery and cannot be read or forked", async () => {
		const shareId = await share({ allowDiscovery: true, allowForking: true });
		await db
			.update(tables.chat)
			.set({ status: "archived" })
			.where(eq(tables.chat.id, chatId));
		expect((await app.request(`/public/chats/share/${shareId}`)).status).toBe(
			404,
		);
		expect((await fork(shareId)).status).toBe(404);
		expect(await (await app.request("/public/chats/share")).json()).toEqual({
			shares: [],
		});
	});
});
