import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, sql, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { buildBatchOutputLine } from "@llmgateway/shared/batch";
import { encryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

import {
	BATCH_CLEANUP_INTERVAL_MS,
	BATCH_REQUEST_CONCURRENCY_PER_BATCH,
	cleanupExpiredBatchData,
	createBatchLoopState,
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
		case "revoked":
			return json(401, { error: { message: "Invalid API key" } });
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
		expect(rows.e).toMatchObject({ status: "pending", attempts: 1 });

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
		expect(rows.e).toMatchObject({
			status: "failed",
			attempts: 3,
			responseStatus: 500,
		});

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

	test("waits when the key hits its usage limit", async () => {
		await createBatch([line("a", "revoked"), line("b", "ok")]);
		await runBatchHousekeeping();

		await processOnce(1);

		const rows = await requestsByCustomId();
		expect(rows.a).toMatchObject({ status: "pending", attempts: 0 });
		const fourMinutesMs = 4 * 60 * 1000;
		expect(rows.a.nextAttemptAt.getTime()).toBeGreaterThan(
			Date.now() + fourMinutesMs,
		);
		expect(rows.b.status).toBe("pending");
	});

	test("stops a batch when its API key is disabled", async () => {
		await db
			.update(tables.apiKey)
			.set({ status: "inactive" })
			.where(eq(tables.apiKey.id, apiKeyId));
		await createBatch([line("a", "revoked"), line("b", "ok"), line("c", "ok")]);
		await runBatchHousekeeping();

		await processOnce(1);
		await runBatchHousekeeping();

		const batch = await loadBatch();
		expect(batch).toMatchObject({ status: "completed", requestFailed: 3 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const rows = await requestsByCustomId();
		expect(rows.b.error?.code).toBe("authentication_failed");
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

	test("puts requests of a crashed worker back in the queue", async () => {
		await createBatch([line("a", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.batchRequest)
			.set({ status: "in_progress", claimedUntil: new Date(Date.now() - 1000) })
			.where(eq(tables.batchRequest.batchId, batchId));

		await runBatchHousekeeping();
		await processOnce(16);
		await runBatchHousekeeping();

		expect((await loadBatch()).status).toBe("completed");
		expect(fetchMock).toHaveBeenCalledTimes(1);
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

		await cleanupExpiredBatchData();

		expect(await loadBatch()).toBeUndefined();
		const files = await db
			.select()
			.from(tables.batchFile)
			.where(eq(tables.batchFile.id, fileId));
		expect(files).toEqual([]);
	});
});
