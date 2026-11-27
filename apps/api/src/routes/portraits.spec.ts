import { createServer, type Server } from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import {
	encryptAssetCredentials,
	encryptProviderKeyForStorage,
} from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";

import type { AddressInfo } from "node:net";

const ORG_ID = "portraits-org";
const KEY_ID = "portraits-bytedance-key";
const ACCESS_KEY_ID = ["AKLT", "portraits", "spec", "id"].join("");
const SECRET_ACCESS_KEY = ["portraits", "spec", "secret", "value"].join("-");

interface RecordedCall {
	action: string;
	body: Record<string, unknown>;
	authorization: string | undefined;
}

describe("portraits", () => {
	let token: string;
	let server: Server;
	let calls: RecordedCall[] = [];
	let assetStatus = "Processing";
	let verifiedGroupId: string | null = null;

	beforeAll(async () => {
		server = createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			let raw = "";
			req.on("data", (chunk: Buffer) => {
				raw += chunk.toString();
			});
			req.on("end", () => {
				const action = url.searchParams.get("Action") ?? "";
				const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
				calls.push({ action, body, authorization: req.headers.authorization });
				const results: Record<string, unknown> = {
					CreateVisualValidateSession: {
						BytedToken: "byted-token-1",
						H5Link: "https://verify.example.com/session",
					},
					GetVisualValidateResult: verifiedGroupId
						? { GroupId: verifiedGroupId }
						: {},
					CreateAsset: { Id: "asset-20260101000000-new01" },
					GetAsset: {
						Id: body.Id,
						GroupId: "group-20260101000000-imprt",
						Status: assetStatus,
						AssetType: "Image",
						Name: "Front",
					},
				};
				res.setHeader("Content-Type", "application/json");
				res.end(
					JSON.stringify({
						ResponseMetadata: { RequestId: "req", Action: action },
						Result: results[action] ?? {},
					}),
				);
			});
		});
		await new Promise<void>((resolve) => server.listen(0, resolve));
		vi.stubEnv(
			"BYTEPLUS_OPENAPI_URL",
			`http://localhost:${(server.address() as AddressInfo).port}`,
		);
	});

	afterAll(async () => {
		vi.unstubAllEnvs();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	beforeEach(async () => {
		calls = [];
		assetStatus = "Processing";
		verifiedGroupId = null;
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Portraits Org",
			billingEmail: "portraits@example.com",
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: "test-user-id",
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.providerKey).values({
			id: KEY_ID,
			...encryptProviderKeyForStorage("ark-portraits-spec", KEY_ID, ORG_ID),
			provider: "bytedance",
			organizationId: ORG_ID,
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	function call(method: string, path: string, body?: unknown) {
		return app.request(path, {
			method,
			headers: { "Content-Type": "application/json", Cookie: token },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	}

	async function storeCredentials() {
		const res = await call("PUT", `/portraits/credentials/${KEY_ID}`, {
			organizationId: ORG_ID,
			accessKeyId: ACCESS_KEY_ID,
			secretAccessKey: SECRET_ACCESS_KEY,
		});
		expect(res.status).toBe(200);
		return res;
	}

	test("stores a BYOK access key pair encrypted and never returns it", async () => {
		const res = await storeCredentials();
		const text = await res.text();
		expect(text.includes(SECRET_ACCESS_KEY)).toBe(false);
		expect(text.includes(ACCESS_KEY_ID)).toBe(false);

		const [row] = await db
			.select()
			.from(tables.providerKeyAssetCredential)
			.where(eq(tables.providerKeyAssetCredential.providerKeyId, KEY_ID));
		expect(row.credentialsCiphertext.includes(SECRET_ACCESS_KEY)).toBe(false);

		const list = await call("GET", `/portraits?organizationId=${ORG_ID}`);
		const json = await list.json();
		expect(json.platformAvailable).toBe(false);
		expect(json.byokKeys).toEqual([
			expect.objectContaining({ id: KEY_ID, hasAssetCredentials: true }),
		]);
	});

	test("verifies a person, adds an asset and tracks its status on a BYOK key", async () => {
		const withoutCredentials = await call("POST", "/portraits", {
			organizationId: ORG_ID,
			name: "Actor",
			credentialSource: "byok",
			providerKeyId: KEY_ID,
		});
		expect(withoutCredentials.status).toBe(400);
		expect(calls).toHaveLength(0);

		await storeCredentials();
		const created = await call("POST", "/portraits", {
			organizationId: ORG_ID,
			name: "Actor",
			credentialSource: "byok",
			providerKeyId: KEY_ID,
		});
		expect(created.status).toBe(200);
		const { portrait, verificationUrl } = await created.json();
		expect(verificationUrl).toBe("https://verify.example.com/session");
		expect(portrait.status).toBe("pending_verification");
		expect(calls[0].action).toBe("CreateVisualValidateSession");
		expect(
			calls[0].authorization?.startsWith(
				`HMAC-SHA256 Credential=${ACCESS_KEY_ID}/`,
			),
		).toBe(true);
		expect(String(calls[0].body.CallbackURL)).toContain(
			`/portrait-verification?portrait=${portrait.id}`,
		);

		const notYet = await call("POST", `/portraits/${portrait.id}/refresh`);
		expect((await notYet.json()).portrait.status).toBe("pending_verification");

		const early = await call("POST", `/portraits/${portrait.id}/assets`, {
			url: "https://example.com/face.jpg",
			assetType: "image",
		});
		expect(early.status).toBe(400);

		verifiedGroupId = "group-20260101000000-actor";
		const verified = await call("POST", `/portraits/${portrait.id}/refresh`);
		const verifiedJson = await verified.json();
		expect(verifiedJson.portrait.status).toBe("active");
		expect(verifiedJson.portrait.upstreamGroupId).toBe(verifiedGroupId);
		expect(
			calls.find((entry) => entry.action === "GetVisualValidateResult")?.body
				.BytedToken,
		).toBe("byted-token-1");

		const added = await call("POST", `/portraits/${portrait.id}/assets`, {
			url: "https://example.com/face.jpg",
			assetType: "image",
			name: "Front",
		});
		expect(added.status).toBe(200);
		const [asset] = (await added.json()).portrait.assets;
		expect(asset).toMatchObject({
			status: "processing",
			upstreamAssetId: "asset-20260101000000-new01",
			uri: `asset://${asset.id}`,
		});
		expect(calls.at(-1)?.body).toMatchObject({
			GroupId: verifiedGroupId,
			URL: "https://example.com/face.jpg",
			AssetType: "Image",
		});

		assetStatus = "Active";
		const refreshed = await call("POST", `/portraits/${portrait.id}/refresh`);
		expect((await refreshed.json()).portrait.assets[0].status).toBe("active");

		// BYOK assets live in the organization's own account: only unlinked.
		const callCount = calls.length;
		const removed = await call("DELETE", `/portraits/assets/${asset.id}`);
		expect(removed.status).toBe(200);
		expect(calls).toHaveLength(callCount);
	});

	test("imports an existing BytePlus asset on a BYOK key", async () => {
		await storeCredentials();
		assetStatus = "Active";
		const res = await call("POST", "/portraits/import", {
			organizationId: ORG_ID,
			providerKeyId: KEY_ID,
			upstreamAssetId: "asset-20260101000000-exist",
		});
		expect(res.status).toBe(200);
		const { portrait } = await res.json();
		expect(portrait).toMatchObject({
			status: "active",
			credentialSource: "byok",
			upstreamGroupId: "group-20260101000000-imprt",
		});
		expect(portrait.assets).toEqual([
			expect.objectContaining({
				status: "active",
				upstreamAssetId: "asset-20260101000000-exist",
			}),
		]);
	});

	test("platform portraits need a managed key pair and credits, and delete upstream", async () => {
		const create = () =>
			call("POST", "/portraits", {
				organizationId: ORG_ID,
				name: "Actor",
				credentialSource: "platform",
			});

		const noCredits = await create();
		expect(noCredits.status).toBe(402);

		await db
			.update(tables.organization)
			.set({ credits: "25" })
			.where(eq(tables.organization.id, ORG_ID));
		const unavailable = await create();
		expect(unavailable.status).toBe(400);

		await db.insert(tables.providerKey).values({
			id: "managed-bytedance",
			...encryptProviderKeyForStorage(
				"ark-managed-spec",
				"managed-bytedance",
				null,
			),
			provider: "bytedance",
			organizationId: null,
			managed: true,
		});
		await db.insert(tables.providerKeyAssetCredential).values({
			id: "managed-bytedance-assets",
			providerKeyId: "managed-bytedance",
			organizationId: null,
			...encryptAssetCredentials(
				{ accessKeyId: ACCESS_KEY_ID, secretAccessKey: SECRET_ACCESS_KEY },
				"managed-bytedance-assets",
				null,
			),
		});

		const created = await create();
		expect(created.status).toBe(200);
		const { portrait } = await created.json();
		expect(portrait.credentialSource).toBe("platform");
		expect(portrait.providerKeyId).toBeNull();
		expect(
			calls[0].authorization?.startsWith(
				`HMAC-SHA256 Credential=${ACCESS_KEY_ID}/`,
			),
		).toBe(true);

		verifiedGroupId = "group-20260101000000-plat1";
		const refreshed = await call("POST", `/portraits/${portrait.id}/refresh`);
		const refreshedJson = await refreshed.json();
		expect(refreshedJson.portrait.status).toBe("active");
		// LLM Gateway's account ids stay internal.
		expect(refreshedJson.portrait.upstreamGroupId).toBeNull();

		const removed = await call("DELETE", `/portraits/${portrait.id}`);
		expect(removed.status).toBe(200);
		expect(calls.at(-1)).toMatchObject({
			action: "DeleteAssetGroup",
			body: expect.objectContaining({ Id: verifiedGroupId }),
		});
	});

	test("rejects members who are not owners or admins", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, `${ORG_ID}-owner`));
		const res = await call("GET", `/portraits?organizationId=${ORG_ID}`);
		expect(res.status).toBe(403);
	});
});
