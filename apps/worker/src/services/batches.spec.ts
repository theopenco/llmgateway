import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, sql, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { buildBatchOutputLine } from "@llmgateway/shared/batch";
import { encryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

import {
	BATCH_CLEANUP_INTERVAL_MS,
	BATCH_MAX_QUEUED_REQUESTS_PER_ORG,
	BATCH_REQUEST_CONCURRENCY_PER_BATCH,
	claimBatchRequests,
	cleanupExpiredBatchData,
	createBatchLoopState,
	drainBatchRequests,
	finalizeBatches,
	runBatchHousekeeping,
	runBatchLoopIteration,
	startBatchRequests,
} from "./batches.js";

/** Starts one claim round the way the worker loop does and waits for it. */
async function processOnce(limit = 16) {
	const state = createBatchLoopState();
	const started = await startBatchRequests(state, limit);
	await Promise.all([...state.inFlight]);
	return started;
}

const userId = "batch-worker-user";
const organizationId = "batch-worker-org";
const projectId = "batch-worker-project";
const apiKeyId = "batch-worker-key";
const token = ["batch", "worker", "token"].join("-");
const batchId = "batch_worker_test";
const fileId = "file-worker-test";
const gatewayUrl = "http://gateway.batch.test";

const fetchMock = vi.fn<typeof fetch>();

interface GatewayCall {
	url: string;
	headers: Headers;
	body: { messages: { content: string }[] };
}

function calls(): GatewayCall[] {
	return fetchMock.mock.calls.map(([input, init]) => ({
		url: String(input),
		headers: new Headers(init?.headers),
		body: JSON.parse(String(init?.body)),
	}));
}

function line(customId: string, content: string) {
	return JSON.stringify({
		custom_id: customId,
		method: "POST",
		url: "/v1/chat/completions",
		body: { model: "gpt-4o-mini", messages: [{ role: "user", content }] },
	});
}

const flaky = new Map<string, number>();

async function gateway(input: string | URL | Request, init?: RequestInit) {
	const content = JSON.parse(String(init?.body)).messages[0].content as string;
	const requestId = new Headers(init?.headers).get("x-request-id") ?? "";
	const json = (status: number, body: unknown, headers = {}) =>
		new Response(JSON.stringify(body), {
			status,
			headers: {
				"content-type": "application/json",
				"x-request-id": requestId,
				...headers,
			},
		});
	switch (content) {
		case "ok":
			return json(200, {
				id: `chatcmpl-${requestId}`,
				object: "chat.completion",
			});
		case "bad":
			return json(400, { error: { message: "bad request" } });
		case "throttle":
			return json(
				429,
				{ error: { message: "slow down" } },
				{ "retry-after": "120" },
			);
		case "flaky": {
			const seen = (flaky.get(requestId) ?? 0) + 1;
			flaky.set(requestId, seen);
			return seen === 1
				? json(503, { error: { message: "unavailable" } })
				: json(200, { id: "chatcmpl-recovered" });
		}
		case "down":
			return json(500, { error: { message: "down" } });
		case "unavailable":
			return json(503, { error: { message: "unavailable" } });
		case "upstream":
			return json(500, {
				error: {
					message: "Error from provider",
					type: "upstream_error",
					code: "upstream_error",
				},
			});
		case "broke":
			return json(402, { error: { message: "add credits" } });
		case "limited":
			return json(401, {
				error: {
					message: "usage limit",
					code: "api_key_usage_limit_exceeded",
				},
			});
		case "budget":
			return json(403, {
				error: { message: "budget", code: "member_budget_exceeded" },
			});
		case "forbidden":
			return json(403, {
				error: { message: "denied", code: "permission_denied" },
			});
		case "revoked":
			return json(401, {
				error: { message: "Invalid API key", code: "invalid_api_key" },
			});
		default:
			throw new TypeError(`unexpected ${String(input)}`);
	}
}

async function cleanup() {
	await db.delete(tables.batch).where(eq(tables.batch.projectId, projectId));
	await db
		.delete(tables.batchFile)
		.where(eq(tables.batchFile.projectId, projectId));
	await db.delete(tables.apiKey).where(eq(tables.apiKey.id, apiKeyId));
	await db.delete(tables.project).where(eq(tables.project.id, projectId));
	await db
		.delete(tables.organization)
		.where(eq(tables.organization.id, organizationId));
	await db.delete(tables.user).where(eq(tables.user.id, userId));
}

async function createBatch(
	lines: string[],
	options: { expiresAt?: Date; status?: "validating" | "cancelling" } = {},
) {
	await db.insert(tables.batchFile).values({
		id: fileId,
		organizationId,
		projectId,
		apiKeyId,
		purpose: "batch",
		filename: "input.jsonl",
		bytes: 1,
		content: lines.join("\n"),
		expiresAt: new Date(Date.now() + 86_400_000),
	});
	await db.insert(tables.batch).values({
		id: batchId,
		organizationId,
		projectId,
		apiKeyId,
		endpoint: "/v1/chat/completions",
		inputFileId: fileId,
		status: options.status ?? "validating",
		clientIp: "203.0.113.7",
		expiresAt: options.expiresAt ?? new Date(Date.now() + 86_400_000),
	});
	await db.insert(tables.batchCredential).values({
		batchId,
		apiKeyId,
		encryptedToken: encryptProviderKey(
			token,
			`batch:${batchId}`,
			organizationId,
		),
	});
}

async function loadBatch() {
	const [row] = await db
		.select()
		.from(tables.batch)
		.where(eq(tables.batch.id, batchId));
	return row;
}

async function requestsByCustomId() {
	const rows = await db
		.select()
		.from(tables.batchRequest)
		.where(eq(tables.batchRequest.batchId, batchId));
	return Object.fromEntries(rows.map((row) => [row.customId, row]));
}

async function makeRetriesDue() {
	await db
		.update(tables.batchRequest)
		.set({ nextAttemptAt: new Date(0) })
		.where(eq(tables.batchRequest.status, "pending"));
}

async function credentialExists() {
	const rows = await db
		.select({ batchId: tables.batchCredential.batchId })
		.from(tables.batchCredential)
		.where(eq(tables.batchCredential.batchId, batchId));
	return rows.length > 0;
}

describe("batch worker", () => {
	beforeEach(async () => {
		await cleanup();
		await db
			.insert(tables.user)
			.values({ id: userId, email: "batch@example.com" });
		await db.insert(tables.organization).values({
			id: organizationId,
			name: "Batch org",
			billingEmail: "batch@example.com",
		});
		await db
			.insert(tables.project)
			.values({ id: projectId, name: "Batch project", organizationId });
		await db.insert(tables.apiKey).values({
			id: apiKeyId,
			...hashApiKeyForStorage(token),
			projectId,
			createdBy: userId,
			description: "Batch key",
		});
		flaky.clear();
		fetchMock.mockReset();
		fetchMock.mockImplementation(gateway);
		vi.stubGlobal("fetch", fetchMock);
		vi.stubEnv("GATEWAY_URL", gatewayUrl);
		vi.stubEnv("GATEWAY_BACKEND_URL", "");
		vi.stubEnv("CLIENT_IP_HEADER", "X-Forwarded-For");
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		await cleanup();
	});

	test("runs a batch end to end through the gateway", async () => {
		await createBatch([
			line("a", "ok"),
			line("b", "bad"),
			line("c", "flaky"),
			line("d", "throttle"),
			line("e", "down"),
		]);

		await runBatchHousekeeping();
		expect(await loadBatch()).toMatchObject({
			status: "in_progress",
			requestTotal: 5,
		});

		expect(await processOnce(16)).toBe(5);
		const first = calls();
		expect(first).toHaveLength(5);
		for (const call of first) {
			expect(call.url).toBe(`${gatewayUrl}/v1/chat/completions`);
			expect(call.headers.get("authorization") === `Bearer ${token}`).toBe(
				true,
			);
			expect(call.headers.get("x-source")).toBe("llmgateway-batch");
			expect(call.headers.get("x-forwarded-for")).toBe("203.0.113.7");
			expect(call.headers.get("x-request-id")).toMatch(/^batch_req_/);
		}

		let rows = await requestsByCustomId();
		expect(rows.a).toMatchObject({ status: "completed", responseStatus: 200 });
		expect(rows.b).toMatchObject({ status: "failed", responseStatus: 400 });
		expect(rows.c).toMatchObject({ status: "pending", attempts: 1 });
		expect(rows.d).toMatchObject({ status: "pending", attempts: 0 });
		expect(rows.d.nextAttemptAt.getTime()).toBeGreaterThan(
			Date.now() + 100_000,
		);
		// A 500 may follow a billed call, so it is not retried.
		expect(rows.e).toMatchObject({
			status: "failed",
			attempts: 1,
			responseStatus: 500,
		});

		for (let round = 0; round < 3; round++) {
			await makeRetriesDue();
			fetchMock.mockImplementation(async (input, init) => {
				const content = JSON.parse(String(init?.body)).messages[0].content;
				return await gateway(input, {
					...init,
					body:
						content === "throttle"
							? JSON.stringify({ messages: [{ content: "ok" }] })
							: init?.body,
				});
			});
			await processOnce(16);
		}

		rows = await requestsByCustomId();
		expect(rows.c).toMatchObject({ status: "completed", attempts: 2 });
		expect(rows.d).toMatchObject({ status: "completed" });
		expect(rows.e).toMatchObject({ status: "failed", attempts: 1 });
		expect(
			calls().filter((call) => call.body.messages[0].content === "down"),
		).toHaveLength(1);

		await runBatchHousekeeping();
		const finished = await loadBatch();
		expect(finished).toMatchObject({
			status: "completed",
			requestTotal: 5,
			requestCompleted: 3,
			requestFailed: 2,
			claimedUntil: null,
		});
		expect(finished.completedAt).not.toBeNull();
		expect(await credentialExists()).toBe(false);

		const files = await db
			.select()
			.from(tables.batchFile)
			.where(eq(tables.batchFile.batchId, batchId));
		const output = files.find((file) => file.id === finished.outputFileId);
		const errors = files.find((file) => file.id === finished.errorFileId);
		expect(output?.purpose).toBe("batch_output");
		expect(errors?.purpose).toBe("batch_error");

		const all = Object.values(await requestsByCustomId());
		const bytes = (statuses: string[]) =>
			all
				.filter((row) => statuses.includes(row.status))
				.reduce(
					(sum, row) =>
						sum +
						Buffer.byteLength(
							buildBatchOutputLine({
								id: row.id,
								customId: row.customId,
								responseStatus: row.responseStatus,
								responseBody: row.responseBody,
								requestId: row.requestId,
								error: row.error,
							}),
						),
					0,
				);
		expect(output?.bytes).toBe(bytes(["completed"]));
		expect(errors?.bytes).toBe(bytes(["failed"]));
	});

	test("the worker loop bounds in-flight requests and finishes the batch", async () => {
		const total = BATCH_REQUEST_CONCURRENCY_PER_BATCH + 2;
		await createBatch(
			Array.from({ length: total }, (_, index) => line(`r${index}`, "ok")),
		);
		const release: (() => void)[] = [];
		fetchMock.mockImplementation(async (input, init) => {
			await new Promise<void>((resolve) => release.push(resolve));
			return await gateway(input, init);
		});
		const state = createBatchLoopState();

		expect(await runBatchLoopIteration(state)).toBe(
			BATCH_REQUEST_CONCURRENCY_PER_BATCH,
		);
		expect(state.inFlight.size).toBe(BATCH_REQUEST_CONCURRENCY_PER_BATCH);
		await vi.waitFor(() =>
			expect(release).toHaveLength(BATCH_REQUEST_CONCURRENCY_PER_BATCH),
		);

		expect(await runBatchLoopIteration(state)).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(
			BATCH_REQUEST_CONCURRENCY_PER_BATCH,
		);

		release.splice(0).forEach((resolve) => resolve());
		await Promise.all([...state.inFlight]);
		expect(state.inFlight.size).toBe(0);

		expect(await runBatchLoopIteration(state)).toBe(2);
		await vi.waitFor(() => expect(release).toHaveLength(2));
		release.splice(0).forEach((resolve) => resolve());
		await Promise.all([...state.inFlight]);
		await runBatchLoopIteration(state);

		expect(await loadBatch()).toMatchObject({
			status: "completed",
			requestCompleted: total,
			requestFailed: 0,
		});
		expect(fetchMock).toHaveBeenCalledTimes(total);
		const ids = calls().map((call) => call.headers.get("x-request-id"));
		expect(new Set(ids).size).toBe(total);
	});

	test("the worker loop runs cleanup at most once an hour", async () => {
		const state = createBatchLoopState();
		const now = new Date();
		await runBatchLoopIteration(state, now);
		expect(state.lastCleanupAt).toBe(now.getTime());

		await runBatchLoopIteration(state, new Date(now.getTime() + 1000));
		expect(state.lastCleanupAt).toBe(now.getTime());

		const later = new Date(now.getTime() + BATCH_CLEANUP_INTERVAL_MS);
		await runBatchLoopIteration(state, later);
		expect(state.lastCleanupAt).toBe(later.getTime());
	});

	test("runs requests whose body contains an escaped NUL character", async () => {
		await createBatch([line("nul", "ok\u0000")]);
		fetchMock.mockImplementation(async (_input, init) => {
			const content = JSON.parse(String(init?.body)).messages[0].content;
			return new Response(JSON.stringify({ echo: content }), {
				headers: { "content-type": "application/json" },
			});
		});

		await runBatchHousekeeping();
		await processOnce();
		await runBatchHousekeeping();

		const rows = await requestsByCustomId();
		expect(JSON.parse(rows.nul.body).messages[0].content).toBe("ok\u0000");
		expect(JSON.parse(rows.nul.responseBody ?? "null").echo).toBe("ok\u0000");
		expect((await loadBatch()).status).toBe("completed");
	});

	test("fails a batch whose input does not validate", async () => {
		await createBatch([line("a", "ok"), line("a", "ok"), "{oops"]);

		await runBatchHousekeeping();

		const batch = await loadBatch();
		expect(batch.status).toBe("failed");
		expect(batch.errors).toEqual([
			expect.objectContaining({ code: "duplicate_custom_id", line: 2 }),
			expect.objectContaining({ code: "invalid_json_line", line: 3 }),
		]);
		expect(await credentialExists()).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("cancels pending requests and reports them in the error file", async () => {
		await createBatch([line("a", "ok"), line("b", "ok"), line("c", "ok")]);
		await runBatchHousekeeping();
		await processOnce(1);
		await db
			.update(tables.batch)
			.set({ status: "cancelling", cancellingAt: new Date() })
			.where(eq(tables.batch.id, batchId));

		await runBatchHousekeeping();

		const batch = await loadBatch();
		expect(batch).toMatchObject({
			status: "cancelled",
			requestCompleted: 1,
			requestFailed: 0,
		});
		const [errorFile] = await db
			.select()
			.from(tables.batchFile)
			.where(eq(tables.batchFile.id, batch.errorFileId ?? ""));
		expect(errorFile.bytes).toBeGreaterThan(0);
		const rows = Object.values(await requestsByCustomId());
		expect(rows.filter((row) => row.status === "cancelled")).toHaveLength(2);
		expect(await credentialExists()).toBe(false);
	});

	test("expires requests that miss the completion window", async () => {
		await createBatch([line("a", "ok"), line("b", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.batch)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.batch.id, batchId));

		await runBatchHousekeeping();
		expect(await processOnce(16)).toBe(0);

		const batch = await loadBatch();
		expect(batch.status).toBe("expired");
		expect(batch.requestFailed).toBe(0);
		expect(batch.errorFileId).not.toBeNull();
		const rows = Object.values(await requestsByCustomId());
		expect(rows.every((row) => row.error?.code === "batch_expired")).toBe(true);
	});

	test.each(["limited", "budget"])(
		"waits when the gateway reports a spend limit (%s)",
		async (content) => {
			await createBatch([line("a", content), line("b", "ok")]);
			await runBatchHousekeeping();

			await processOnce(1);

			const rows = await requestsByCustomId();
			expect(rows.a).toMatchObject({ status: "pending", attempts: 0 });
			const fiveMinutesMs = 5 * 60 * 1000;
			expect(rows.a.nextAttemptAt.getTime()).toBeGreaterThan(
				Date.now() + fiveMinutesMs - 5000,
			);
			expect(rows.b.status).toBe("pending");
			expect(await credentialExists()).toBe(true);
		},
	);

	test("fails the batch on any other 401 and drops its credential", async () => {
		await createBatch([line("a", "revoked"), line("b", "ok"), line("c", "ok")]);
		await runBatchHousekeeping();

		await processOnce(1);
		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "completed",
			requestFailed: 3,
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(await credentialExists()).toBe(false);
		const rows = await requestsByCustomId();
		expect(rows.a.responseStatus).toBe(401);
		expect(rows.b.error?.code).toBe("authentication_failed");
	});

	test("fails a line on other 403s without retrying it", async () => {
		await createBatch([line("a", "forbidden"), line("b", "ok")]);
		await runBatchHousekeeping();

		await processOnce();
		await makeRetriesDue();
		await processOnce();

		const rows = await requestsByCustomId();
		expect(rows.a).toMatchObject({ status: "failed", responseStatus: 403 });
		expect(rows.b.status).toBe("completed");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	test("drops the credential and stops a batch once its key is disabled", async () => {
		await createBatch([line("a", "ok"), line("b", "ok"), line("c", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.id, apiKeyId));

		await runBatchHousekeeping();
		expect(await credentialExists()).toBe(false);
		await processOnce();
		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "completed",
			requestFailed: 3,
		});
		expect(fetchMock).not.toHaveBeenCalled();
		const rows = await requestsByCustomId();
		expect(rows.b.error?.code).toBe("authentication_failed");
	});

	test("drops the credential of an expired key", async () => {
		await createBatch([line("a", "ok")]);
		await db
			.update(tables.apiKey)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.apiKey.id, apiKeyId));

		await runBatchHousekeeping();

		expect(await credentialExists()).toBe(false);
	});

	test("requeues a 402 without spending an attempt and charges once", async () => {
		await createBatch([line("a", "broke")]);
		await runBatchHousekeeping();

		await processOnce();
		let row = (await requestsByCustomId()).a;
		expect(row).toMatchObject({ status: "pending", attempts: 0 });
		expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);

		await makeRetriesDue();
		fetchMock.mockImplementation(
			async (input, init) =>
				await gateway(input, {
					...init,
					body: JSON.stringify({ messages: [{ content: "ok" }] }),
				}),
		);
		await processOnce();

		row = (await requestsByCustomId()).a;
		expect(row).toMatchObject({ status: "completed", attempts: 1 });
		const ids = calls().map((call) => call.headers.get("x-request-id"));
		expect(ids).toEqual([row.id, row.id]);
	});

	test("retries a 503 with the same request id and settles once", async () => {
		await createBatch([line("a", "flaky")]);
		await runBatchHousekeeping();

		await processOnce();
		await makeRetriesDue();
		await processOnce();
		await makeRetriesDue();
		await processOnce();

		const row = (await requestsByCustomId()).a;
		expect(row).toMatchObject({ status: "completed", attempts: 2 });
		expect(calls().map((call) => call.headers.get("x-request-id"))).toEqual([
			row.id,
			row.id,
		]);
	});

	test("retries unbilled gateway errors up to three attempts", async () => {
		await createBatch([line("a", "unavailable"), line("b", "upstream")]);
		await runBatchHousekeeping();

		for (let round = 0; round < 4; round++) {
			await makeRetriesDue();
			await processOnce();
		}

		const rows = await requestsByCustomId();
		expect(rows.a).toMatchObject({
			status: "failed",
			attempts: 3,
			responseStatus: 503,
		});
		expect(rows.b).toMatchObject({
			status: "failed",
			attempts: 3,
			responseStatus: 500,
		});
		expect(fetchMock).toHaveBeenCalledTimes(6);
	});

	test("adds jitter to requeued requests", async () => {
		await createBatch(
			Array.from({ length: 20 }, (_, index) => line(`t${index}`, "throttle")),
		);
		await runBatchHousekeeping();
		const before = Date.now();

		await processOnce(BATCH_REQUEST_CONCURRENCY_PER_BATCH);

		const due = Object.values(await requestsByCustomId())
			.filter(
				(row) => row.attempts === 0 && row.nextAttemptAt.getTime() > before,
			)
			.map((row) => row.nextAttemptAt.getTime() - before);
		expect(due).toHaveLength(BATCH_REQUEST_CONCURRENCY_PER_BATCH);
		for (const delay of due) {
			expect(delay).toBeGreaterThanOrEqual(120_000 - 1000);
			expect(delay).toBeLessThanOrEqual(144_000 + 1000);
		}
		expect(new Set(due).size).toBeGreaterThan(1);
	});

	test("does not resend a request that timed out", async () => {
		await createBatch([line("a", "ok")]);
		fetchMock.mockImplementation(async () => {
			throw new DOMException("The operation timed out.", "TimeoutError");
		});
		await runBatchHousekeeping();

		await processOnce();
		await makeRetriesDue();
		await processOnce();

		expect((await requestsByCustomId()).a).toMatchObject({
			status: "failed",
			error: expect.objectContaining({ code: "request_failed" }),
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	test("fails a line whose response is too large to store", async () => {
		await createBatch([line("a", "ok")]);
		const tenMegabytes = 10 * 1024 * 1024;
		const huge = "x".repeat(tenMegabytes + 1);
		fetchMock.mockImplementation(
			async () =>
				new Response(JSON.stringify({ text: huge }), {
					headers: { "content-type": "application/json" },
				}),
		);
		await runBatchHousekeeping();

		await processOnce();

		expect((await requestsByCustomId()).a).toMatchObject({
			status: "failed",
			responseStatus: 200,
			responseBody: null,
			error: expect.objectContaining({ code: "response_too_large" }),
		});
	});

	test("fails a batch past the organization's queued request limit", async () => {
		await db.insert(tables.batch).values({
			id: `${batchId}_big`,
			organizationId,
			projectId,
			apiKeyId,
			endpoint: "/v1/chat/completions",
			inputFileId: fileId,
			status: "in_progress",
			requestTotal: BATCH_MAX_QUEUED_REQUESTS_PER_ORG,
			expiresAt: new Date(Date.now() + 86_400_000),
		});
		await createBatch([line("a", "ok")]);

		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "failed",
			errors: [expect.objectContaining({ code: "request_limit_exceeded" })],
		});
		expect(await credentialExists()).toBe(false);
	});

	test("expires a batch that could not be validated in its window", async () => {
		await createBatch([line("a", "ok")], {
			expiresAt: new Date(Date.now() - 1000),
		});

		await runBatchHousekeeping();

		const batch = await loadBatch();
		expect(batch).toMatchObject({
			status: "expired",
			errors: [expect.objectContaining({ code: "batch_expired" })],
		});
		expect(batch.expiredAt).not.toBeNull();
		expect(await credentialExists()).toBe(false);
	});

	test("expires a started batch through its requests, keeping them for the error file", async () => {
		await createBatch([line("a", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.batch)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.batch.id, batchId));
		const [started] = await db
			.select({ status: tables.batch.status })
			.from(tables.batch)
			.where(eq(tables.batch.id, batchId));
		expect(started.status).toBe("in_progress");

		await runBatchHousekeeping();

		expect((await loadBatch()).status).toBe("expired");
		const rows = await requestsByCustomId();
		expect(rows.a.error?.code).toBe("batch_expired");
	});

	test("leaves a validating batch to the validator that holds its lease", async () => {
		await createBatch([line("a", "ok")], {
			expiresAt: new Date(Date.now() - 1000),
		});
		await db
			.update(tables.batch)
			.set({ claimedUntil: new Date(Date.now() + 60_000) })
			.where(eq(tables.batch.id, batchId));

		await runBatchHousekeeping();

		expect((await loadBatch()).status).toBe("validating");
	});

	test("finalizes once and counts only the batches it finalized", async () => {
		await createBatch([line("a", "ok")]);
		await runBatchHousekeeping();
		await processOnce();
		await db
			.update(tables.batch)
			.set({ claimedUntil: new Date(Date.now() + 60_000) })
			.where(eq(tables.batch.id, batchId));

		expect(await finalizeBatches()).toBe(0);
		await db
			.update(tables.batch)
			.set({ claimedUntil: null })
			.where(eq(tables.batch.id, batchId));
		expect(await finalizeBatches()).toBe(1);
		expect(await finalizeBatches()).toBe(0);

		const files = await db
			.select()
			.from(tables.batchFile)
			.where(eq(tables.batchFile.batchId, batchId));
		expect(files).toHaveLength(1);
	});

	test("fails the remaining requests when the credential is gone", async () => {
		await createBatch([line("a", "ok"), line("b", "ok"), line("c", "ok")]);
		await runBatchHousekeeping();
		await db
			.delete(tables.batchCredential)
			.where(eq(tables.batchCredential.batchId, batchId));

		await processOnce(1);
		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "completed",
			requestFailed: 3,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("fails the remaining requests when the credential cannot be decrypted", async () => {
		await createBatch([line("a", "ok"), line("b", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.batchCredential)
			.set({
				encryptedToken: encryptProviderKey(
					token,
					"batch:other",
					organizationId,
				),
			})
			.where(eq(tables.batchCredential.batchId, batchId));

		await processOnce(1);
		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "completed",
			requestFailed: 2,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("fails a batch whose input file was deleted", async () => {
		await createBatch([line("a", "ok")]);
		await db.delete(tables.batchFile).where(eq(tables.batchFile.id, fileId));

		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "failed",
			errors: [expect.objectContaining({ code: "input_file_missing" })],
		});
	});

	test("cancels a batch before it was validated", async () => {
		await createBatch([line("a", "ok")], { status: "cancelling" });

		await runBatchHousekeeping();

		expect(await loadBatch()).toMatchObject({
			status: "cancelled",
			requestTotal: 0,
		});
		expect(await credentialExists()).toBe(false);
	});

	test("sends Responses API batches to /v1/responses", async () => {
		await createBatch([
			JSON.stringify({
				custom_id: "r",
				method: "POST",
				url: "/v1/responses",
				body: {
					model: "gpt-4o-mini",
					input: "hi",
					messages: [{ content: "ok" }],
				},
			}),
		]);
		await db
			.update(tables.batch)
			.set({ endpoint: "/v1/responses" })
			.where(eq(tables.batch.id, batchId));
		await runBatchHousekeeping();

		await processOnce(16);

		expect(calls()[0].url).toBe(`${gatewayUrl}/v1/responses`);
		expect((await requestsByCustomId()).r.status).toBe("completed");
	});

	test("splits claim slots across active batches", async () => {
		await createBatch(
			Array.from({ length: 10 }, (_, index) => line(`a${index}`, "ok")),
		);
		await runBatchHousekeeping();
		const otherId = `${batchId}_other`;
		await db.insert(tables.batch).values({
			id: otherId,
			organizationId,
			projectId,
			apiKeyId,
			endpoint: "/v1/chat/completions",
			inputFileId: fileId,
			status: "in_progress",
			expiresAt: new Date(Date.now() + 86_400_000),
		});
		await db.insert(tables.batchRequest).values(
			Array.from({ length: 10 }, (_, index) => ({
				id: `batch_req_other_${index}`,
				batchId: otherId,
				lineNumber: index + 1,
				customId: `b${index}`,
				body: "{}",
				nextAttemptAt: new Date(0),
			})),
		);

		const claimed = await claimBatchRequests(4);

		const perBatch = new Map<string, number>();
		for (const request of claimed) {
			perBatch.set(request.batchId, (perBatch.get(request.batchId) ?? 0) + 1);
		}
		expect(Object.fromEntries(perBatch)).toEqual({
			[batchId]: 2,
			[otherId]: 2,
		});
	});

	test("splits claim slots across organizations before batches", async () => {
		const otherOrg = `${organizationId}_other`;
		const otherProject = `${projectId}_other`;
		await db.insert(tables.organization).values({
			id: otherOrg,
			name: "Other batch org",
			billingEmail: "batch@example.com",
		});
		await db.insert(tables.project).values({
			id: otherProject,
			name: "Other batch project",
			organizationId: otherOrg,
		});
		const insertBatch = async (id: string, org: string, project: string) => {
			await db.insert(tables.batch).values({
				id,
				organizationId: org,
				projectId: project,
				endpoint: "/v1/chat/completions",
				inputFileId: fileId,
				status: "in_progress",
				expiresAt: new Date(Date.now() + 86_400_000),
			});
			await db.insert(tables.batchRequest).values(
				Array.from({ length: 10 }, (_, index) => ({
					id: `batch_req_${id}_${index}`,
					batchId: id,
					lineNumber: index + 1,
					customId: `r${index}`,
					body: "{}",
					nextAttemptAt: new Date(0),
				})),
			);
		};
		try {
			for (let index = 0; index < 3; index++) {
				await insertBatch(`${batchId}_a${index}`, organizationId, projectId);
			}
			await insertBatch(`${batchId}_b`, otherOrg, otherProject);

			const claimed = await claimBatchRequests(4);

			const perOrg = { mine: 0, other: 0 };
			for (const request of claimed) {
				perOrg[request.batchId.endsWith("_b") ? "other" : "mine"]++;
			}
			expect(perOrg).toEqual({ mine: 2, other: 2 });
		} finally {
			await db
				.delete(tables.batch)
				.where(eq(tables.batch.projectId, otherProject));
			await db
				.delete(tables.project)
				.where(eq(tables.project.id, otherProject));
			await db
				.delete(tables.organization)
				.where(eq(tables.organization.id, otherOrg));
		}
	});

	test("caps running requests per organization across its batches", async () => {
		await createBatch(
			Array.from({ length: 10 }, (_, index) => line(`a${index}`, "ok")),
		);
		await runBatchHousekeeping();

		expect(await claimBatchRequests(10, 8, new Date(), 3)).toHaveLength(3);
		expect(await claimBatchRequests(10, 8, new Date(), 3)).toHaveLength(0);
	});

	test("counts running requests of batches with nothing due against the org cap", async () => {
		await createBatch([line("a", "ok")]);
		await runBatchHousekeeping();
		const busyId = `${batchId}_busy`;
		await db.insert(tables.batch).values({
			id: busyId,
			organizationId,
			projectId,
			endpoint: "/v1/chat/completions",
			inputFileId: fileId,
			status: "in_progress",
			expiresAt: new Date(Date.now() + 86_400_000),
		});
		await db.insert(tables.batchRequest).values(
			Array.from({ length: 3 }, (_, index) => ({
				id: `batch_req_busy_${index}`,
				batchId: busyId,
				lineNumber: index + 1,
				customId: `busy${index}`,
				body: "{}",
				status: "in_progress" as const,
				claimedUntil: new Date(Date.now() + 60_000),
			})),
		);

		expect(await claimBatchRequests(10, 8, new Date(), 3)).toHaveLength(0);
		expect(await claimBatchRequests(10, 8, new Date(), 4)).toHaveLength(1);
	});

	test("fails requests of a crashed worker instead of resending them", async () => {
		await createBatch([line("a", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.batchRequest)
			.set({ status: "in_progress", claimedUntil: new Date(Date.now() - 1000) })
			.where(eq(tables.batchRequest.batchId, batchId));

		await runBatchHousekeeping();
		await processOnce();
		await runBatchHousekeeping();

		expect((await requestsByCustomId()).a.error?.code).toBe(
			"request_interrupted",
		);
		expect(await loadBatch()).toMatchObject({
			status: "completed",
			requestFailed: 1,
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	test("retries only network errors that prove the request was not sent", async () => {
		await createBatch([line("refused", "refused"), line("reset", "reset")]);
		fetchMock.mockImplementation(async (_input, init) => {
			const content = JSON.parse(String(init?.body)).messages[0].content;
			const code = content === "refused" ? "ECONNREFUSED" : "ECONNRESET";
			throw new TypeError("fetch failed", {
				cause: Object.assign(new Error(code), { code }),
			});
		});
		await runBatchHousekeeping();

		await processOnce();

		const rows = await requestsByCustomId();
		expect(rows.refused).toMatchObject({ status: "pending", attempts: 1 });
		expect(rows.reset).toMatchObject({ status: "failed" });
		expect(rows.reset.error?.code).toBe("request_failed");
	});

	test("fails a request whose response body cannot be read", async () => {
		await createBatch([line("a", "ok")]);
		fetchMock.mockImplementation(
			async () =>
				new Response(
					new ReadableStream({
						start(controller) {
							controller.error(new Error("socket closed"));
						},
					}),
					{ status: 200 },
				),
		);
		await runBatchHousekeeping();

		await processOnce();

		expect((await requestsByCustomId()).a).toMatchObject({
			status: "failed",
			responseStatus: 200,
			error: expect.objectContaining({ code: "response_read_failed" }),
		});
	});

	test("fails requests still running when the worker drains on shutdown", async () => {
		await createBatch([line("a", "ok")]);
		fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
		await runBatchHousekeeping();
		const state = createBatchLoopState();
		await startBatchRequests(state);

		expect(await drainBatchRequests(state, 20)).toBe(1);

		expect((await requestsByCustomId()).a).toMatchObject({
			status: "failed",
			error: expect.objectContaining({ code: "request_interrupted" }),
		});
	});

	test("deletes expired files and old finished batches", async () => {
		await createBatch([line("a", "ok")]);
		await db
			.update(tables.batchFile)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(tables.batchFile.id, fileId));
		await db
			.update(tables.batch)
			.set({ status: "completed" })
			.where(eq(tables.batch.id, batchId));
		await db.execute(
			sql`update batch set updated_at = now() - interval '31 days' where id = ${batchId}`,
		);

		expect(await cleanupExpiredBatchData()).toMatchObject({ drained: true });

		expect(await loadBatch()).toBeUndefined();
		const files = await db
			.select()
			.from(tables.batchFile)
			.where(eq(tables.batchFile.id, fileId));
		expect(files).toEqual([]);
	});

	test("cleans up in chunks until no expired data is left", async () => {
		const expired = new Date(Date.now() - 1000);
		await db.insert(tables.batchFile).values(
			Array.from({ length: 1201 }, (_, index) => ({
				id: `file-cleanup-${index}`,
				organizationId,
				projectId,
				purpose: "batch" as const,
				filename: "old.jsonl",
				bytes: 1,
				content: "",
				expiresAt: expired,
			})),
		);

		expect(await cleanupExpiredBatchData(new Date(), 0)).toMatchObject({
			files: 0,
			drained: false,
		});
		const result = await cleanupExpiredBatchData();
		expect(result.drained).toBe(true);
		expect(result.files).toBeGreaterThanOrEqual(1201);
	});
});
