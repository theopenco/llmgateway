import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
	batchProcessLogs,
	createBatchLoopState,
	runBatchHousekeeping,
	startBatchRequests,
} from "worker";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "@/test-utils/test-helpers.js";

import { db, eq, sql, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { batchGatewayHeaders } from "@llmgateway/shared/batch";
import { decryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

const TOKEN = "batch-test-token";
const OTHER_TOKEN = "batch-other-project-token";

function chatLine(customId: string) {
	return JSON.stringify({
		custom_id: customId,
		method: "POST",
		url: "/v1/chat/completions",
		body: {
			model: "gpt-4o-mini",
			messages: [{ role: "user", content: `hello ${customId}` }],
		},
	});
}

function auth(token = TOKEN, extra: Record<string, string> = {}) {
	return { Authorization: `Bearer ${token}`, ...extra };
}

async function uploadFile(
	content: string,
	options: { token?: string; purpose?: string; filename?: string } = {},
) {
	const form = new FormData();
	form.append("purpose", options.purpose ?? "batch");
	form.append(
		"file",
		new File([content], options.filename ?? "requests.jsonl", {
			type: "application/jsonl",
		}),
	);
	return await app.request("/v1/files", {
		method: "POST",
		headers: auth(options.token),
		body: form,
	});
}

async function createBatch(inputFileId: string, extra = {}) {
	return await app.request("/v1/batches", {
		method: "POST",
		headers: auth(TOKEN, {
			"Content-Type": "application/json",
			"X-Forwarded-For": "203.0.113.7",
		}),
		body: JSON.stringify({
			input_file_id: inputFileId,
			endpoint: "/v1/chat/completions",
			completion_window: "24h",
			...extra,
		}),
	});
}

const GATEWAY_TEST_URL = "http://gateway.batch.test";

/** Runs the worker's batch loop once, sending its calls into this gateway. */
async function runWorker() {
	await runBatchHousekeeping();
	const state = createBatchLoopState();
	await startBatchRequests(state);
	await Promise.all([...state.inFlight]);
	await runBatchHousekeeping();
}

describe("Batch API", () => {
	const harness = createGatewayApiTestHarness();
	const realFetch = globalThis.fetch;

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
	});

	function routeWorkerToGateway() {
		vi.stubEnv("GATEWAY_URL", GATEWAY_TEST_URL);
		vi.stubEnv("GATEWAY_BACKEND_URL", "");
		vi.stubEnv("LLM_OPENAI_API_KEY", ["sk", "batch", "test"].join("-"));
		vi.stubEnv("LLM_OPENAI_BASE_URL", harness.mockServerUrl);
		vi.stubGlobal(
			"fetch",
			async (input: string | URL | Request, init?: RequestInit) => {
				const url = new URL(input instanceof Request ? input.url : input);
				if (url.origin !== GATEWAY_TEST_URL) {
					return await realFetch(input, init);
				}
				return await app.request(`${url.pathname}${url.search}`, init);
			},
		);
	}

	async function credits() {
		const [org] = await db
			.select({ credits: tables.organization.credits })
			.from(tables.organization)
			.where(eq(tables.organization.id, "org-id"));
		return new Decimal(org.credits);
	}

	async function logsFor(requestId: string) {
		return await db
			.select()
			.from(tables.log)
			.where(eq(tables.log.requestId, requestId));
	}

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "batch-key",
			...hashApiKeyForStorage(TOKEN),
			projectId: "project-id",
			description: "Batch key",
			createdBy: "user-id",
		});
		await db.insert(tables.project).values({
			id: "other-project",
			name: "Other",
			organizationId: "org-id",
			mode: "api-keys",
		});
		await db.insert(tables.apiKey).values({
			id: "other-key",
			...hashApiKeyForStorage(OTHER_TOKEN),
			projectId: "other-project",
			description: "Other project key",
			createdBy: "user-id",
		});
	});

	test("uploads, lists, retrieves, downloads and deletes a file", async () => {
		const content = `${chatLine("a")}\n${chatLine("b")}\n`;
		const upload = await uploadFile(content);
		expect(upload.status, await upload.clone().text()).toBe(200);
		const file = await upload.json();
		expect(file).toMatchObject({
			object: "file",
			purpose: "batch",
			filename: "requests.jsonl",
			bytes: Buffer.byteLength(content),
			status: "processed",
		});
		expect(file.id).toMatch(/^file-/);
		expect(file.expires_at - file.created_at).toBe(30 * 24 * 60 * 60);

		const list = await (
			await app.request("/v1/files?purpose=batch", { headers: auth() })
		).json();
		expect(list).toMatchObject({ object: "list", has_more: false });
		expect(list.data.map((f: { id: string }) => f.id)).toEqual([file.id]);

		const retrieved = await app.request(`/v1/files/${file.id}`, {
			headers: auth(),
		});
		expect(await retrieved.json()).toEqual(file);

		const downloaded = await app.request(`/v1/files/${file.id}/content`, {
			headers: auth(),
		});
		expect(downloaded.headers.get("content-type")).toContain("jsonl");
		expect(await downloaded.text()).toBe(content);

		const deleted = await app.request(`/v1/files/${file.id}`, {
			method: "DELETE",
			headers: auth(),
		});
		expect(await deleted.json()).toEqual({
			id: file.id,
			object: "file",
			deleted: true,
		});
		const gone = await app.request(`/v1/files/${file.id}`, {
			headers: auth(),
		});
		expect(gone.status).toBe(404);
	});

	test("rejects files containing NUL bytes", async () => {
		const res = await uploadFile(`${chatLine("a")}\u0000\n`);
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain("NUL");

		const escaped = JSON.stringify({
			custom_id: "escaped",
			method: "POST",
			url: "/v1/chat/completions",
			body: {
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "a\u0000b" }],
			},
		});
		expect(escaped.includes("\\u0000")).toBe(true);
		expect((await uploadFile(escaped)).status).toBe(200);
	});

	test("rejects unsupported purposes and missing files", async () => {
		expect(
			(await uploadFile(chatLine("a"), { purpose: "fine-tune" })).status,
		).toBe(400);
		const form = new FormData();
		form.append("purpose", "batch");
		const missing = await app.request("/v1/files", {
			method: "POST",
			headers: auth(),
			body: form,
		});
		expect(missing.status).toBe(400);
	});

	test("requires a valid API key", async () => {
		expect((await app.request("/v1/files")).status).toBe(401);
		const form = new FormData();
		form.append("purpose", "batch");
		form.append("file", new File([chatLine("a")], "requests.jsonl"));
		const upload = await app.request("/v1/files", {
			method: "POST",
			headers: auth("nope"),
			body: form,
		});
		expect(upload.status).toBe(401);
		expect(
			(await app.request("/v1/batches", { headers: auth("nope") })).status,
		).toBe(401);
	});

	test("creates a batch with an encrypted credential and the client IP", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();

		const res = await createBatch(file.id, { metadata: { team: "search" } });
		expect(res.status, await res.clone().text()).toBe(200);
		const batch = await res.json();
		expect(batch).toMatchObject({
			object: "batch",
			endpoint: "/v1/chat/completions",
			input_file_id: file.id,
			completion_window: "24h",
			status: "validating",
			output_file_id: null,
			error_file_id: null,
			errors: null,
			request_counts: { total: 0, completed: 0, failed: 0 },
			metadata: { team: "search" },
		});
		expect(batch.id).toMatch(/^batch_/);
		expect(batch.expires_at - batch.created_at).toBe(24 * 60 * 60);

		const [row] = await db
			.select()
			.from(tables.batch)
			.where(eq(tables.batch.id, batch.id));
		expect(row.clientIp).toBe("203.0.113.7");
		const [credential] = await db
			.select()
			.from(tables.batchCredential)
			.where(eq(tables.batchCredential.batchId, batch.id));
		expect(credential.encryptedToken.includes(TOKEN)).toBe(false);
		expect(
			decryptProviderKey(
				credential.encryptedToken,
				`batch:${batch.id}`,
				"org-id",
			) === TOKEN,
		).toBe(true);

		const listed = await (
			await app.request("/v1/batches", { headers: auth() })
		).json();
		expect(listed.data.map((b: { id: string }) => b.id)).toEqual([batch.id]);
		expect(JSON.stringify(listed)).not.toContain("encrypted");
	});

	test("validates the batch request body", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		expect(
			(await createBatch(file.id, { endpoint: "/v1/images/generations" }))
				.status,
		).toBe(400);
		expect(
			(await createBatch(file.id, { completion_window: "48h" })).status,
		).toBe(400);
		const tooMuchMetadata = Object.fromEntries(
			Array.from({ length: 17 }, (_, index) => [`k${index}`, "v"]),
		);
		expect(
			(await createBatch(file.id, { metadata: tooMuchMetadata })).status,
		).toBe(400);
		expect(
			(await createBatch(file.id, { metadata: { note: "a\u0000b" } })).status,
		).toBe(400);
		expect((await createBatch("file-missing")).status).toBe(404);
	});

	test("scopes files and batches to the key's project", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const batch = await (await createBatch(file.id)).json();

		for (const path of [
			`/v1/files/${file.id}`,
			`/v1/files/${file.id}/content`,
			`/v1/batches/${batch.id}`,
		]) {
			const res = await app.request(path, { headers: auth(OTHER_TOKEN) });
			expect(res.status, path).toBe(404);
		}
		const cancel = await app.request(`/v1/batches/${batch.id}/cancel`, {
			method: "POST",
			headers: auth(OTHER_TOKEN),
		});
		expect(cancel.status).toBe(404);
		const otherList = await (
			await app.request("/v1/batches", { headers: auth(OTHER_TOKEN) })
		).json();
		expect(otherList.data).toEqual([]);

		const otherFile = await (
			await uploadFile(chatLine("x"), { token: OTHER_TOKEN })
		).json();
		expect((await createBatch(otherFile.id)).status).toBe(404);
	});

	test("cancels a running batch once and refuses finished ones", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const batch = await (await createBatch(file.id)).json();

		const first = await app.request(`/v1/batches/${batch.id}/cancel`, {
			method: "POST",
			headers: auth(),
		});
		expect((await first.json()).status).toBe("cancelling");
		const again = await app.request(`/v1/batches/${batch.id}/cancel`, {
			method: "POST",
			headers: auth(),
		});
		expect(again.status).toBe(200);

		await db
			.update(tables.batch)
			.set({ status: "completed" })
			.where(eq(tables.batch.id, batch.id));
		const done = await app.request(`/v1/batches/${batch.id}/cancel`, {
			method: "POST",
			headers: auth(),
		});
		expect(done.status).toBe(400);
	});

	test("streams output and error files from batch requests", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const batch = await (await createBatch(file.id)).json();
		await db.insert(tables.batchRequest).values([
			{
				id: "batch_req_ok",
				batchId: batch.id,
				lineNumber: 1,
				customId: "a",
				body: "{}",
				status: "completed",
				responseStatus: 200,
				responseBody: '{"id":"chatcmpl-1"}',
				requestId: "req-1",
			},
			{
				id: "batch_req_bad",
				batchId: batch.id,
				lineNumber: 2,
				customId: "b",
				body: "{}",
				status: "failed",
				responseStatus: 400,
				responseBody: '{"error":{"message":"bad"}}',
				requestId: "req-2",
			},
			{
				id: "batch_req_late",
				batchId: batch.id,
				lineNumber: 3,
				customId: "c",
				body: "{}",
				status: "expired",
				error: { code: "batch_expired", message: "late" },
			},
		]);
		await db.insert(tables.batchFile).values([
			{
				id: "file-output",
				organizationId: "org-id",
				projectId: "project-id",
				purpose: "batch_output",
				filename: "out.jsonl",
				bytes: 0,
				batchId: batch.id,
				expiresAt: new Date(Date.now() + 60_000),
			},
			{
				id: "file-errors",
				organizationId: "org-id",
				projectId: "project-id",
				purpose: "batch_error",
				filename: "err.jsonl",
				bytes: 0,
				batchId: batch.id,
				expiresAt: new Date(Date.now() + 60_000),
			},
		]);

		const output = await (
			await app.request("/v1/files/file-output/content", { headers: auth() })
		).text();
		expect(
			output
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l)),
		).toEqual([
			{
				id: "batch_req_ok",
				custom_id: "a",
				response: {
					status_code: 200,
					request_id: "req-1",
					body: { id: "chatcmpl-1" },
				},
				error: null,
			},
		]);

		const errors = await (
			await app.request("/v1/files/file-errors/content", { headers: auth() })
		).text();
		expect(
			errors
				.trim()
				.split("\n")
				.map((l) => JSON.parse(l).custom_id),
		).toEqual(["b", "c"]);
	});

	test("paginates batches that share a millisecond", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const ids: string[] = [];
		for (let index = 0; index < 3; index++) {
			ids.push((await (await createBatch(file.id)).json()).id);
		}
		await db.execute(
			sql`update batch set created_at = timestamp '2026-11-08 10:00:00.123001' + case when id = ${ids[0]} then interval '1 microsecond' when id = ${ids[1]} then interval '2 microsecond' else interval '3 microsecond' end where project_id = 'project-id'`,
		);
		const seen: string[] = [];
		let after: string | null = null;
		for (let page = 0; page < 5; page++) {
			const res: Response = await app.request(
				`/v1/batches?limit=1${after ? `&after=${after}` : ""}`,
				{ headers: auth() },
			);
			const body = await res.json();
			seen.push(...body.data.map((b: { id: string }) => b.id));
			if (!body.has_more) {
				break;
			}
			after = body.last_id;
		}
		expect(seen).toEqual([ids[2], ids[1], ids[0]]);
	});

	test("paginates batches with after and limit", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const ids: string[] = [];
		for (let index = 0; index < 3; index++) {
			ids.push((await (await createBatch(file.id)).json()).id);
		}
		const first = await (
			await app.request("/v1/batches?limit=2", { headers: auth() })
		).json();
		expect(first.has_more).toBe(true);
		expect(first.data).toHaveLength(2);
		const second = await (
			await app.request(`/v1/batches?limit=2&after=${first.last_id}`, {
				headers: auth(),
			})
		).json();
		expect(second.has_more).toBe(false);
		expect(
			[...first.data, ...second.data].map((b: { id: string }) => b.id).sort(),
		).toEqual([...ids].sort());
		expect(
			(await app.request("/v1/batches?limit=101", { headers: auth() })).status,
		).toBe(400);
		expect(
			(
				await app.request("/v1/batches?after=batch_unknown", {
					headers: auth(),
				})
			).status,
		).toBe(400);
	});

	test("rejects uploads past the project's storage quota", async () => {
		await db.insert(tables.batchFile).values(
			Array.from({ length: 6 }, (_, index) => ({
				id: `file-huge-${index}`,
				organizationId: "org-id",
				projectId: "project-id",
				purpose: "batch" as const,
				filename: "huge.jsonl",
				bytes: 2_000_000_000,
				content: "",
				expiresAt: new Date(Date.now() + 60_000),
			})),
		);

		expect((await uploadFile(chatLine("a"))).status).toBe(413);
	});

	test("reports live request counts while a batch runs", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const batch = await (await createBatch(file.id)).json();
		await db
			.update(tables.batch)
			.set({ status: "in_progress", requestTotal: 3 })
			.where(eq(tables.batch.id, batch.id));
		await db.insert(tables.batchRequest).values(
			(["completed", "failed", "pending"] as const).map((status, index) => ({
				id: `batch_req_live_${index}`,
				batchId: batch.id,
				lineNumber: index + 1,
				customId: `c${index}`,
				body: "{}",
				status,
			})),
		);

		const retrieved = await (
			await app.request(`/v1/batches/${batch.id}`, { headers: auth() })
		).json();
		expect(retrieved.request_counts).toEqual({
			total: 3,
			completed: 1,
			failed: 1,
		});
		const listed = await (
			await app.request("/v1/batches", { headers: auth() })
		).json();
		expect(listed.data[0].request_counts).toEqual({
			total: 3,
			completed: 1,
			failed: 1,
		});
	});

	test("deleting an output file deletes its responses", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const batch = await (await createBatch(file.id)).json();
		await db.insert(tables.batchRequest).values([
			{
				id: "batch_req_done",
				batchId: batch.id,
				lineNumber: 1,
				customId: "a",
				body: "{}",
				status: "completed",
				responseStatus: 200,
				responseBody: "{}",
			},
			{
				id: "batch_req_err",
				batchId: batch.id,
				lineNumber: 2,
				customId: "b",
				body: "{}",
				status: "failed",
			},
		]);
		await db.insert(tables.batchFile).values({
			id: "file-output-del",
			organizationId: "org-id",
			projectId: "project-id",
			purpose: "batch_output",
			filename: "out.jsonl",
			bytes: 0,
			batchId: batch.id,
			expiresAt: new Date(Date.now() + 60_000),
		});

		const res = await app.request("/v1/files/file-output-del", {
			method: "DELETE",
			headers: auth(),
		});
		expect(res.status).toBe(200);

		const remaining = await db
			.select({ id: tables.batchRequest.id })
			.from(tables.batchRequest)
			.where(eq(tables.batchRequest.batchId, batch.id));
		expect(remaining.map((row) => row.id)).toEqual(["batch_req_err"]);
	});

	test("rejects files that are not valid UTF-8", async () => {
		const form = new FormData();
		form.append("purpose", "batch");
		form.append(
			"file",
			new File([new Uint8Array([0x7b, 0xff, 0xfe, 0x7d])], "bad.jsonl"),
		);
		const res = await app.request("/v1/files", {
			method: "POST",
			headers: auth(),
			body: form,
		});
		expect(res.status).toBe(400);
		expect((await res.json()).error.message).toContain("UTF-8");
	});

	test("serves file content as a download", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		const res = await app.request(`/v1/files/${file.id}/content`, {
			headers: auth(),
		});
		expect(res.headers.get("x-content-type-options")).toBe("nosniff");
		expect(res.headers.get("content-disposition")).toContain("attachment");
	});

	test("treats expired files as gone", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		await db
			.update(tables.batchFile)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.batchFile.id, file.id));

		expect(
			(await app.request(`/v1/files/${file.id}`, { headers: auth() })).status,
		).toBe(404);
		expect((await createBatch(file.id)).status).toBe(404);
		const list = await (
			await app.request("/v1/files", { headers: auth() })
		).json();
		expect(list.data).toEqual([]);
	});

	test("counts every batch file against the quota and lets one of two racing uploads through", async () => {
		const content = chatLine("a");
		const quota = 10 * 1024 * 1024 * 1024;
		const chunk = 2_000_000_000;
		const fullChunks = 5 * chunk;
		const rest = quota - fullChunks - Buffer.byteLength(content) - 1;
		await db.insert(tables.batchFile).values(
			[chunk, chunk, chunk, chunk, chunk, rest].map((bytes, index) => ({
				id: `file-output-big-${index}`,
				organizationId: "org-id",
				projectId: "project-id",
				purpose: "batch_output" as const,
				filename: "out.jsonl",
				bytes,
				expiresAt: new Date(Date.now() + 60_000),
			})),
		);

		const results = await Promise.all([
			uploadFile(content),
			uploadFile(content),
		]);

		expect(results.map((res) => res.status).sort()).toEqual([200, 413]);
	});

	test("requires credits before queuing batch work in credits mode", async () => {
		await harness.setProjectMode("credits");
		await harness.setOrganizationCredits("0");
		await db.insert(tables.batchFile).values({
			id: "file-no-credits",
			organizationId: "org-id",
			projectId: "project-id",
			purpose: "batch",
			filename: "in.jsonl",
			bytes: 1,
			content: chatLine("a"),
			expiresAt: new Date(Date.now() + 60_000),
		});

		const upload = await uploadFile(chatLine("b"));
		expect(upload.status).toBe(402);
		const create = await createBatch("file-no-credits");
		expect(create.status).toBe(402);

		await harness.setOrganizationCredits("5");
		await clearCache();
		expect((await uploadFile(chatLine("b"))).status).toBe(200);
		expect((await createBatch("file-no-credits")).status).toBe(200);
	});

	test("rejects batch storage while zero data retention is active", async () => {
		await db
			.update(tables.organization)
			.set({
				providerCompliancePolicy: { enabled: true, zeroDataRetention: true },
			})
			.where(eq(tables.organization.id, "org-id"));
		await clearCache();

		const upload = await uploadFile(chatLine("a"));
		expect(upload.status).toBe(400);
		expect((await upload.json()).error.code).toBe("zdr_storage_conflict");
		const create = await createBatch("file-missing");
		expect(create.status).toBe(400);
		expect(await db.select().from(tables.batchFile)).toHaveLength(0);
	});

	test("caps the batches an organization can run at once", async () => {
		const file = await (await uploadFile(chatLine("a"))).json();
		await db.insert(tables.batch).values(
			Array.from({ length: 100 }, (_, index) => ({
				id: `batch_cap_${index}`,
				organizationId: "org-id",
				projectId: "other-project",
				endpoint: "/v1/chat/completions" as const,
				inputFileId: file.id,
				status: "in_progress" as const,
				expiresAt: new Date(Date.now() + 60_000),
			})),
		);

		const res = await createBatch(file.id);
		expect(res.status).toBe(429);

		await db
			.update(tables.batch)
			.set({ status: "completed" })
			.where(eq(tables.batch.id, "batch_cap_0"));
		expect((await createBatch(file.id)).status).toBe(200);
	});

	test("returns a distinct error code when the key reached its usage limit", async () => {
		await db
			.update(tables.apiKey)
			.set({ usageLimit: "1", usage: "1" })
			.where(eq(tables.apiKey.id, "batch-key"));

		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: auth(TOKEN, { "Content-Type": "application/json" }),
			body: JSON.stringify({
				model: "gpt-4o-mini",
				messages: [{ role: "user", content: "hi" }],
			}),
		});

		expect(res.status).toBe(401);
		expect((await res.json()).error.code).toBe("api_key_usage_limit_exceeded");
	});

	test("bills a batch line exactly like the same live request", async () => {
		routeWorkerToGateway();
		await harness.setProjectMode("credits");
		const body = {
			model: "openai/gpt-4o-mini",
			messages: [{ role: "user", content: "Hello from a batch" }],
		};

		const live = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: batchGatewayHeaders({
				token: TOKEN,
				requestId: "live-parity",
				clientIp: null,
			}),
			body: JSON.stringify(body),
		});
		expect(live.status, await live.clone().text()).toBe(200);
		const liveLog = await waitForLogByRequestId("live-parity");
		const beforeLive = await credits();
		await batchProcessLogs();
		const liveCharge = beforeLive.minus(await credits());

		const file = await (
			await uploadFile(
				JSON.stringify({
					custom_id: "parity",
					method: "POST",
					url: "/v1/chat/completions",
					body,
				}),
			)
		).json();
		const batch = await (await createBatch(file.id)).json();
		await runWorker();

		const [request] = await db
			.select()
			.from(tables.batchRequest)
			.where(eq(tables.batchRequest.batchId, batch.id));
		expect(request.status).toBe("completed");
		const batchLog = await waitForLogByRequestId(request.id);
		expect(batchLog.source).toBe("llmgateway-batch");
		for (const field of [
			"cost",
			"inputCost",
			"outputCost",
			"cachedInputCost",
			"requestCost",
		] as const) {
			expect(
				new Decimal(batchLog[field] ?? 0).equals(liveLog[field] ?? 0),
				field,
			).toBe(true);
		}
		expect(batchLog.promptTokens).toBe(liveLog.promptTokens);
		expect(batchLog.completionTokens).toBe(liveLog.completionTokens);

		const beforeBatch = await credits();
		await batchProcessLogs();
		const batchCharge = beforeBatch.minus(await credits());
		expect(liveCharge.gt(0)).toBe(true);
		expect(batchCharge.equals(liveCharge)).toBe(true);

		const retrieved = await (
			await app.request(`/v1/batches/${batch.id}`, { headers: auth() })
		).json();
		const output = await (
			await app.request(`/v1/files/${retrieved.output_file_id}/content`, {
				headers: auth(),
			})
		).text();
		const usage = JSON.parse(output).response.body.usage;
		expect(usage.prompt_tokens).toBe(Number(batchLog.promptTokens));
		expect(usage.completion_tokens).toBe(Number(batchLog.completionTokens));
	});

	test("a retried batch line is charged once", async () => {
		routeWorkerToGateway();
		await harness.setProjectMode("credits");
		const file = await (
			await uploadFile(
				JSON.stringify({
					custom_id: "retry",
					method: "POST",
					url: "/v1/chat/completions",
					body: {
						model: "openai/gpt-4o-mini",
						messages: [{ role: "user", content: "TRIGGER_STATUS_503" }],
					},
				}),
			)
		).json();
		const batch = await (await createBatch(file.id)).json();

		await runWorker();
		const [failed] = await db
			.select()
			.from(tables.batchRequest)
			.where(eq(tables.batchRequest.batchId, batch.id));
		// The gateway reports the provider outage as an unbilled upstream error.
		expect(failed).toMatchObject({ status: "pending", attempts: 1 });
		const errorLog = await waitForLogByRequestId(failed.id);
		expect(errorLog.finishReason).toBe("upstream_error");

		// The provider recovers before the retry.
		await db
			.update(tables.batchRequest)
			.set({
				nextAttemptAt: new Date(0),
				body: JSON.stringify({
					model: "openai/gpt-4o-mini",
					messages: [{ role: "user", content: "recovered" }],
				}),
			})
			.where(eq(tables.batchRequest.id, failed.id));
		await runWorker();

		const [done] = await db
			.select()
			.from(tables.batchRequest)
			.where(eq(tables.batchRequest.batchId, batch.id));
		expect(done).toMatchObject({ status: "completed", attempts: 2 });
		await vi.waitFor(async () => {
			await waitForLogByRequestId(done.id);
			expect(
				(await logsFor(done.id)).filter((row) => !row.retried).length,
			).toBe(2);
		});
		const charge = (row: {
			cost: number | null;
			dataStorageCost: string | null;
		}) => new Decimal(row.cost ?? 0).plus(row.dataStorageCost ?? 0);
		const charged = (await logsFor(done.id)).filter((row) => charge(row).gt(0));
		expect(charged).toHaveLength(1);
		expect(charged[0].finishReason).toBe("stop");

		const before = await credits();
		await batchProcessLogs();
		expect(before.minus(await credits()).equals(charge(charged[0]))).toBe(true);
	});
});
