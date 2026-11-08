import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, eq, sql, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";
import { buildBatchOutputLine } from "@llmgateway/shared/batch";
import { encryptProviderKey } from "@llmgateway/shared/provider-key-crypto";

import {
	cleanupExpiredBatchData,
	processBatchRequestsOnce,
	runBatchHousekeeping,
} from "./batches.js";

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

		expect(await processBatchRequestsOnce(16)).toBe(5);
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
			await processBatchRequestsOnce(16);
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
		await processBatchRequestsOnce(1);
		await db
			.update(tables.batch)
			.set({ status: "cancelling", cancellingAt: new Date() })
			.where(eq(tables.batch.id, batchId));

		await runBatchHousekeeping();

		const batch = await loadBatch();
		expect(batch).toMatchObject({
			status: "cancelled",
			requestCompleted: 1,
			requestFailed: 2,
		});
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
		expect(await processBatchRequestsOnce(16)).toBe(0);

		const batch = await loadBatch();
		expect(batch.status).toBe("expired");
		expect(batch.requestFailed).toBe(2);
		const rows = Object.values(await requestsByCustomId());
		expect(rows.every((row) => row.error?.code === "batch_expired")).toBe(true);
	});

	test("stops a batch when its API key is rejected", async () => {
		await createBatch([line("a", "revoked"), line("b", "ok"), line("c", "ok")]);
		await runBatchHousekeeping();

		await processBatchRequestsOnce(1);
		await runBatchHousekeeping();

		const batch = await loadBatch();
		expect(batch).toMatchObject({ status: "completed", requestFailed: 3 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const rows = await requestsByCustomId();
		expect(rows.b.error?.code).toBe("authentication_failed");
	});

	test("puts requests of a crashed worker back in the queue", async () => {
		await createBatch([line("a", "ok")]);
		await runBatchHousekeeping();
		await db
			.update(tables.batchRequest)
			.set({ status: "in_progress", claimedUntil: new Date(Date.now() - 1000) })
			.where(eq(tables.batchRequest.batchId, batchId));

		await runBatchHousekeeping();
		await processBatchRequestsOnce(16);
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
