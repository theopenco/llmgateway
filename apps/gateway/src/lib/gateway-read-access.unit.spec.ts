import { Hono } from "hono";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { getAuthenticatedReadAccess } from "./gateway-read-access.js";

const mocks = vi.hoisted(() => ({ findKey: vi.fn(), getAccess: vi.fn() }));
vi.mock("@/lib/cached-queries.js", () => ({
	findApiKeyByToken: mocks.findKey,
}));
vi.mock("@/models/model-access.js", () => ({
	getModelsAccess: mocks.getAccess,
}));

function readApp() {
	const app = new Hono();
	app.get("/", async (c) => {
		const access = await getAuthenticatedReadAccess(c, c.req.query("token"));
		return c.json({ id: access.apiKey.id });
	});
	return app;
}

const ipRule = (cidr: string) => ({
	id: "rule",
	ruleType: "allow_ip_cidrs",
	ruleValue: { ipCidrs: [cidr] },
	status: "active",
});

describe("private metadata authentication", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		const key = {
			id: "key",
			keyType: "user",
			status: "active",
			usage: "1",
			usageLimit: "1",
		};
		mocks.findKey.mockResolvedValue(key);
		mocks.getAccess.mockResolvedValue({
			apiKey: key,
			organization: { id: "org" },
			clientIp: "198.51.100.1",
			iamRules: { key: [], member: [], team: [] },
		});
	});

	test("keeps reads available at exhausted quota", async () => {
		expect(
			(
				await readApp().request("/", {
					headers: { Authorization: "Bearer fixture" },
				})
			).status,
		).toBe(200);
	});

	test.each([undefined, { keyType: "user", status: "inactive" }])(
		"rejects missing/inactive key %j",
		async (key) => {
			mocks.findKey.mockResolvedValue(key);
			expect(
				(
					await readApp().request("/", {
						headers: { Authorization: "Bearer fixture" },
					})
				).status,
			).toBe(401);
			expect(mocks.getAccess).not.toHaveBeenCalled();
		},
	);

	test.each([
		{ keyType: "platform_publishable" },
		{ keyType: "user", endUserSession: { id: "session" } },
	])("rejects unsupported principal %j", async (key) => {
		mocks.findKey.mockResolvedValue({ ...key, status: "active" });
		expect(
			(
				await readApp().request("/", {
					headers: { Authorization: "Bearer fixture" },
				})
			).status,
		).toBe(403);
		expect(mocks.getAccess).not.toHaveBeenCalled();
	});

	test.each(["team", "member", "key"])(
		"keeps %s IP rules mandatory",
		async (scope) => {
			const access = await mocks.getAccess();
			access.iamRules[scope] = [ipRule("192.0.2.0/24")];
			expect(
				(
					await readApp().request("/", {
						headers: { Authorization: "Bearer fixture" },
					})
				).status,
			).toBe(403);
		},
	);

	test("preserves allowlist unions within a scope", async () => {
		const access = await mocks.getAccess();
		access.iamRules.key = [ipRule("192.0.2.0/24"), ipRule("198.51.100.0/24")];
		expect(
			(
				await readApp().request("/", {
					headers: { Authorization: "Bearer fixture" },
				})
			).status,
		).toBe(200);
	});

	test("cannot widen a member ceiling with a key allowlist", async () => {
		const access = await mocks.getAccess();
		access.iamRules.member = [ipRule("192.0.2.0/24")];
		access.iamRules.key = [ipRule("198.51.100.0/24")];
		expect(
			(
				await readApp().request("/", {
					headers: { Authorization: "Bearer fixture" },
				})
			).status,
		).toBe(403);
	});

	test("uses the same validation for legacy MCP query tokens", async () => {
		expect((await readApp().request("/?token=legacy-fixture")).status).toBe(
			200,
		);
		expect(mocks.getAccess).toHaveBeenCalledWith(
			expect.anything(),
			"legacy-fixture",
		);
	});
});
