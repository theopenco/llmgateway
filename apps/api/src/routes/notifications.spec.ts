import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

let token: string;
const headers = () => ({ Cookie: token, "Content-Type": "application/json" });
beforeEach(async () => {
	token = await createTestUser();
	await db.insert(tables.organization).values({
		id: "notification-org",
		name: "Test Organization",
		billingEmail: "admin@example.com",
	});
	await db.insert(tables.userOrganization).values({
		userId: "test-user-id",
		organizationId: "notification-org",
		role: "owner",
	});
	await db.insert(tables.project).values({
		id: "notification-project",
		name: "Test Project",
		organizationId: "notification-org",
	});
});
afterEach(deleteAll);

describe("notifications API", () => {
	it("requires authentication", async () => {
		expect((await app.request("/notifications")).status).toBe(401);
	});
	it("starts opted out and persists independent channel preferences", async () => {
		const response = await app.request("/notifications/preferences", {
			headers: headers(),
		});
		expect(response.status).toBe(200);
		expect((await response.json()).preferences).toHaveLength(3);
		const value = {
			type: "budget",
			inApp: true,
			email: false,
			budgetThreshold: 90,
		};
		const saved = await app.request("/notifications/preferences", {
			method: "PUT",
			headers: headers(),
			body: JSON.stringify(value),
		});
		expect(saved.status).toBe(200);
		expect(await saved.json()).toEqual(value);
		const invalid = await app.request("/notifications/preferences", {
			method: "PUT",
			headers: headers(),
			body: JSON.stringify({ ...value, budgetThreshold: 101 }),
		});
		expect(invalid.status).toBe(400);
	});
	it("enforces verified email on the server", async () => {
		await db
			.update(tables.user)
			.set({ emailVerified: false })
			.where(eq(tables.user.id, "test-user-id"));
		const response = await app.request("/notifications/preferences", {
			method: "PUT",
			headers: headers(),
			body: JSON.stringify({
				type: "budget",
				inApp: true,
				email: true,
				budgetThreshold: 80,
			}),
		});
		expect(response.status).toBe(403);
	});
	it("scopes the inbox and read mutations to the recipient and current project access", async () => {
		await db
			.insert(tables.user)
			.values({ id: "another-user", email: "another@example.com" });
		await db.insert(tables.notification).values(
			["test-user-id", "another-user"].map((userId) => ({
				id: `notice-${userId}`,
				userId,
				projectId: "notification-project",
				eventKey: "event",
				type: "budget" as const,
				title: "Budget alert",
				message: "Review your usage",
				href: "/models",
				inApp: true,
				email: false,
			})),
		);
		const response = await app.request("/notifications", {
			headers: headers(),
		});
		expect(response.status).toBe(200);
		const data = await response.json();
		expect(data.unreadCount).toBe(1);
		expect(data.notifications).toHaveLength(1);
		await app.request("/notifications/read", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({
				ids: ["notice-test-user-id", "notice-another-user"],
			}),
		});
		expect(
			(
				await db.query.notification.findFirst({
					where: { id: "notice-test-user-id" },
				})
			)?.readAt,
		).not.toBeNull();
		expect(
			(
				await db.query.notification.findFirst({
					where: { id: "notice-another-user" },
				})
			)?.readAt,
		).toBeNull();
		await db.delete(tables.userOrganization);
		const removed = await app.request("/notifications", { headers: headers() });
		expect((await removed.json()).notifications).toHaveLength(0);
	});
	it("marks older alerts read without changing another recipient's inbox", async () => {
		await db
			.insert(tables.user)
			.values({ id: "another-recipient", email: "recipient@example.com" });
		await db.insert(tables.notification).values(
			Array.from({ length: 52 }, (_, i) => ({
				id: `bulk-${i}`,
				userId: i === 51 ? "another-recipient" : "test-user-id",
				projectId: "notification-project",
				eventKey: `bulk-${i}`,
				type: "budget" as const,
				title: "Budget alert",
				message: "Review usage",
				href: "/models",
				inApp: true,
				email: false,
			})),
		);
		const response = await app.request("/notifications/read", {
			method: "POST",
			headers: headers(),
			body: JSON.stringify({ all: true }),
		});
		expect(response.status).toBe(200);
		const unread = await db.query.notification.findMany({
			where: { readAt: { isNull: true } },
		});
		expect(unread.map((row) => row.userId)).toEqual(["another-recipient"]);
	});
});
