import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { db, eq, sql, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import {
	DATA_STREAM_BATCH_SIZE,
	DATA_STREAM_MAX_FAILURES,
	DATA_STREAM_MAX_REJECTIONS,
	dataStreamRetryAt,
	listActiveDataStreams,
	loadActiveDataStream,
	runDataStream,
} from "./data-stream-runner.js";
import {
	encryptDataStreamSecret,
	formatRequestLogEvent,
	signDataStreamPayload,
	validateDataStreamConfig,
	type RequestLogRow,
} from "./data-streams.js";

const ORG_ID = "data-stream-spec-org";
const USER_ID = "data-stream-spec-user";
const PROJECT_ID = "data-stream-spec-project";
const API_KEY_ID = "data-stream-spec-key";
const STREAM_ID = "data-stream-spec-stream";
const TEN_MINUTES_MS = 600_000;
const ONE_HOUR_MS = 3_600_000;
const SIGNING_SECRET = ["whsec", "spec", "0123456789abcdef"].join("_");

const ids = (prefix: string, count: number) =>
	Array.from(
		{ length: count },
		(_, i) => `${prefix}${String(i).padStart(4, "0")}`,
	);

interface Received {
	body: { events: Record<string, unknown>[] };
	signature: string;
	authorization: string | undefined;
	raw: string;
}

describe("data streams", () => {
	let server: Server;
	let url = "";
	let status = 200;
	const received: Received[] = [];
	const previousGuard = process.env.ALLOW_INSECURE_PROVIDER_URLS;

	beforeAll(async () => {
		process.env.ALLOW_INSECURE_PROVIDER_URLS = "true";
		server = createServer((req, res) => {
			let raw = "";
			req.on("data", (chunk) => (raw += chunk));
			req.on("end", () => {
				received.push({
					raw,
					body: JSON.parse(raw),
					signature: String(req.headers["x-llmgateway-signature"]),
					authorization: req.headers.authorization,
				});
				res.statusCode = status;
				res.end(status === 200 ? "ok" : "boom");
			});
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}/hook`;
	});

	afterAll(() => {
		server.close();
		if (previousGuard === undefined) {
			delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		} else {
			process.env.ALLOW_INSECURE_PROVIDER_URLS = previousGuard;
		}
	});

	beforeEach(async () => {
		status = 200;
		received.length = 0;
		await db.insert(tables.user).values({
			id: USER_ID,
			name: "Data Stream Spec",
			email: "data-stream-spec@example.com",
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Data Stream Spec Org",
			billingEmail: "data-stream-spec@example.com",
			plan: "enterprise",
			dataStreamsEnabled: true,
			requestLogExportEnabled: true,
		});
		await db.insert(tables.userOrganization).values({
			id: `${ORG_ID}-owner`,
			userId: USER_ID,
			organizationId: ORG_ID,
			role: "owner",
		});
		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Data Stream Spec Project",
			organizationId: ORG_ID,
		});
		await db.insert(tables.apiKey).values({
			id: API_KEY_ID,
			...hashApiKeyForStorage("data-stream-spec-token"),
			projectId: PROJECT_ID,
			description: "spec",
			createdBy: USER_ID,
		});
	});

	afterEach(async () => {
		await db
			.delete(tables.organization)
			.where(eq(tables.organization.id, ORG_ID));
		await db.delete(tables.user).where(eq(tables.user.id, USER_ID));
	});

	async function seedAudit(ids: string[], createdAt: Date) {
		await db.insert(tables.auditLog).values(
			ids.map((id) => ({
				id,
				createdAt,
				organizationId: ORG_ID,
				userId: USER_ID,
				action: "project.create" as const,
				resourceType: "project" as const,
				resourceId: `resource-${id}`,
			})),
		);
	}

	async function seedStream(
		cursorCreatedAt: Date,
		overrides: Partial<typeof tables.dataStream.$inferInsert> = {},
	) {
		const [row] = await db
			.insert(tables.dataStream)
			.values({
				id: STREAM_ID,
				organizationId: ORG_ID,
				name: "SIEM",
				source: "audit_logs",
				destination: "webhook",
				config: { url },
				secret: encryptDataStreamSecret(
					{ signingSecret: SIGNING_SECRET, token: "bearer-spec" },
					STREAM_ID,
					ORG_ID,
				),
				cursorCreatedAt: cursorCreatedAt.toISOString(),
				...overrides,
			})
			.returning();
		return row;
	}

	async function reload() {
		const [row] = await db
			.select()
			.from(tables.dataStream)
			.where(eq(tables.dataStream.id, STREAM_ID));
		return row;
	}

	test("delivers settled audit events once, signed, and advances the cursor", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["a1", "a2"], old);
		await seedAudit(["fresh"], new Date(Date.now() + TEN_MINUTES_MS));
		const stream = await seedStream(new Date(old.getTime() - 1000));

		const first = await runDataStream(stream);
		expect(first).toEqual({ delivered: 2 });
		expect(received).toHaveLength(1);
		expect(received[0].body.events.map((event) => event.id)).toEqual([
			"a1",
			"a2",
		]);
		expect(received[0].authorization).toBe("Bearer bearer-spec");
		const [t, v1] = received[0].signature.split(",");
		const expected = createHmac("sha256", SIGNING_SECRET)
			.update(`${t.slice(2)}.${received[0].raw}`)
			.digest("hex");
		expect(v1).toBe(`v1=${expected}`);

		const advanced = await reload();
		expect(advanced.cursorId).toBe("a2");
		expect(advanced.deliveredCount).toBe(2);

		const second = await runDataStream(advanced);
		expect(second).toEqual({ delivered: 0 });
		expect(received).toHaveLength(1);
	});

	test("does not redeliver rows whose created_at has microseconds", async () => {
		// One statement, so both rows share the database's now() to the microsecond.
		await db.insert(tables.auditLog).values(
			["m1", "m2"].map((id) => ({
				id,
				organizationId: ORG_ID,
				userId: USER_ID,
				action: "project.create" as const,
				resourceType: "project" as const,
				resourceId: `resource-${id}`,
				createdAt: sql`now() - interval '1 minute'`,
			})),
		);
		const stream = await seedStream(new Date(Date.now() - TEN_MINUTES_MS));

		expect(await runDataStream(stream)).toEqual({ delivered: 2 });
		expect(await runDataStream(await reload())).toEqual({ delivered: 0 });
		expect(received).toHaveLength(1);
	});

	test("exports request log metadata only, never prompts or completions", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await db.insert(tables.log).values({
			id: "log-spec-1",
			requestId: "req-spec-1",
			createdAt: old,
			organizationId: ORG_ID,
			projectId: PROJECT_ID,
			apiKeyId: API_KEY_ID,
			duration: 120,
			requestedModel: "gpt-4o-mini",
			requestedProvider: "openai",
			usedModel: "openai/gpt-4o-mini",
			usedProvider: "openai",
			responseSize: 10,
			messages: [{ role: "user", content: "secret prompt" }],
			content: "secret answer",
			promptTokens: "10",
			completionTokens: "5",
			totalTokens: "15",
			cost: 0.0001,
			finishReason: "stop",
			mode: "api-keys",
			usedMode: "api-keys",
		});
		const stream = await seedStream(new Date(old.getTime() - 1000), {
			source: "request_logs",
		});

		expect(await runDataStream(stream)).toEqual({ delivered: 1 });
		const [event] = received[0].body.events;
		expect(event.type).toBe("request_log");
		expect(event.usedModel).toBe("openai/gpt-4o-mini");
		expect(event.totalTokens).toBe(15);
		expect(received[0].raw).not.toContain("secret prompt");
		expect(received[0].raw).not.toContain("secret answer");
		expect(event).not.toHaveProperty("messages");
		expect(event).not.toHaveProperty("content");
	});

	test("keeps the cursor and backs off when delivery fails", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["b1"], old);
		const stream = await seedStream(new Date(old.getTime() - 1000));
		status = 500;

		const result = await runDataStream(stream);
		expect(result.error).toContain("500");
		expect(result.paused).toBe(false);
		const failed = await reload();
		expect(failed.cursorId).toBe("");
		expect(failed.lastError).toContain("500");
		expect(failed.failureCount).toBe(1);
		expect(failed.enabled).toBe(true);
		expect((await listActiveDataStreams()).map((s) => s.id)).not.toContain(
			STREAM_ID,
		);
		const retryAt = dataStreamRetryAt(failed)!;
		expect((await listActiveDataStreams(retryAt)).map((s) => s.id)).toContain(
			STREAM_ID,
		);

		status = 200;
		expect(await runDataStream(failed)).toEqual({ delivered: 1 });
		const recovered = await reload();
		expect(recovered.lastError).toBeNull();
		expect(recovered.failureCount).toBe(0);
	});

	test("retry delay doubles per failure and is capped", () => {
		const lastErrorAt = new Date("2026-01-01T00:00:00Z");
		const delay = (failureCount: number) =>
			dataStreamRetryAt({ lastErrorAt, failureCount })!.getTime() -
			lastErrorAt.getTime();
		expect(dataStreamRetryAt({ lastErrorAt, failureCount: 0 })).toBeNull();
		expect(delay(1)).toBe(60_000);
		expect(delay(2)).toBe(120_000);
		expect(delay(4)).toBe(480_000);
		expect(delay(20)).toBe(ONE_HOUR_MS);
	});

	test("pauses after repeated rejections and notifies admins", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["p1"], old);
		// Earlier transient failures do not count towards the rejection limit.
		const stream = await seedStream(new Date(old.getTime() - 1000), {
			failureCount: DATA_STREAM_MAX_REJECTIONS + 4,
			rejectionCount: DATA_STREAM_MAX_REJECTIONS - 2,
			lastErrorAt: new Date(Date.now() - ONE_HOUR_MS),
		});
		status = 413;

		const first = await runDataStream(stream);
		expect(first.paused).toBe(false);
		const rejectedOnce = await reload();
		expect(rejectedOnce.enabled).toBe(true);
		expect(rejectedOnce.rejectionCount).toBe(DATA_STREAM_MAX_REJECTIONS - 1);

		const result = await runDataStream({
			...rejectedOnce,
			lastErrorAt: new Date(Date.now() - ONE_HOUR_MS),
		});
		expect(result.paused).toBe(true);
		const paused = await reload();
		expect(paused.enabled).toBe(false);
		expect(paused.pausedReason).toContain("rejected");
		expect(paused.rejectionCount).toBe(DATA_STREAM_MAX_REJECTIONS);
		expect(paused.failureCount).toBe(DATA_STREAM_MAX_REJECTIONS + 6);
		expect(await loadActiveDataStream(STREAM_ID)).toBeNull();

		const alerts = await db.query.organizationAlert.findMany({
			where: { organizationId: ORG_ID, type: "data_stream" },
		});
		expect(alerts).toHaveLength(1);
		expect(alerts[0].href).toBe(`/dashboard/${ORG_ID}/org/data-streams`);
		const notifications = await db.query.notification.findMany({
			where: { userId: USER_ID, type: "data_stream" },
		});
		expect(notifications).toHaveLength(1);
		expect(notifications[0].email).toBe(true);
	});

	test("transient failures take longer to pause than rejections", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["t1"], old);
		const stream = await seedStream(new Date(old.getTime() - 1000), {
			failureCount: DATA_STREAM_MAX_REJECTIONS,
		});
		status = 503;
		expect((await runDataStream(stream)).paused).toBe(false);
		expect((await reload()).enabled).toBe(true);

		await db
			.update(tables.dataStream)
			.set({ failureCount: DATA_STREAM_MAX_FAILURES - 1 })
			.where(eq(tables.dataStream.id, STREAM_ID));
		expect((await runDataStream(await reload())).paused).toBe(true);
		expect((await reload()).enabled).toBe(false);
	});

	test("records an undecryptable secret as a stream error instead of throwing", async () => {
		const stream = await seedStream(new Date());
		const broken = { ...stream, secret: "not-a-valid-ciphertext" };
		const result = await runDataStream(broken);
		expect(result.delivered).toBe(0);
		expect(result.error).toBeTruthy();
		const after = await reload();
		expect(after.lastError).toBeTruthy();
		expect(after.lastErrorAt).not.toBeNull();
	});

	test("stops after a batch when the stream was paused meanwhile", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["s1"], old);
		const stream = await seedStream(new Date(old.getTime() - 1000));
		await db
			.update(tables.dataStream)
			.set({ enabled: false })
			.where(eq(tables.dataStream.id, STREAM_ID));
		let progress = 0;
		const result = await runDataStream(stream, {
			onProgress: async () => {
				progress++;
			},
		});
		expect(result).toEqual({ delivered: 1 });
		expect(progress).toBe(1);
		const after = await reload();
		expect(after.cursorId).toBe("s1");
		expect(after.enabled).toBe(false);
	});

	test("a failing progress callback is not recorded as a delivery failure", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["g1"], old);
		const stream = await seedStream(new Date(old.getTime() - 1000));

		await expect(
			runDataStream(stream, {
				onProgress: async () => {
					throw new Error("lease check failed");
				},
			}),
		).rejects.toThrow("lease check failed");
		const after = await reload();
		expect(after.cursorId).toBe("g1");
		expect(after.failureCount).toBe(0);
		expect(after.lastError).toBeNull();
		expect(after.lastErrorAt).toBeNull();
	});

	test("only runs streams the organization may export", async () => {
		await seedStream(new Date());
		const active = async () =>
			(await listActiveDataStreams()).some((s) => s.id === STREAM_ID);
		expect(await active()).toBe(true);
		expect(await loadActiveDataStream(STREAM_ID)).not.toBeNull();

		const setOrg = (values: Partial<typeof tables.organization.$inferInsert>) =>
			db
				.update(tables.organization)
				.set(values)
				.where(eq(tables.organization.id, ORG_ID));

		await setOrg({ plan: "pro" });
		expect(await active()).toBe(false);
		await setOrg({ plan: "enterprise", dataStreamsEnabled: false });
		expect(await active()).toBe(false);
		expect(await loadActiveDataStream(STREAM_ID)).toBeNull();
		await setOrg({ dataStreamsEnabled: true, status: "deleted" });
		expect(await active()).toBe(false);

		await setOrg({ status: "active", requestLogExportEnabled: false });
		expect(await active()).toBe(true);
		await db
			.update(tables.dataStream)
			.set({ source: "request_logs" })
			.where(eq(tables.dataStream.id, STREAM_ID));
		expect(await active()).toBe(false);
		await setOrg({ requestLogExportEnabled: true });
		expect(await active()).toBe(true);
	});

	test("a failure after an accepted batch counts from the reset counters", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		const batch = ids("c", DATA_STREAM_BATCH_SIZE + 1);
		await seedAudit(batch, old);
		const stream = await seedStream(new Date(old.getTime() - 1000), {
			failureCount: DATA_STREAM_MAX_FAILURES - 1,
			rejectionCount: DATA_STREAM_MAX_REJECTIONS - 1,
			lastErrorAt: new Date(Date.now() - ONE_HOUR_MS),
		});

		const result = await runDataStream(stream, {
			onProgress: async () => {
				status = 413;
			},
		});
		expect(result.paused).toBe(false);
		expect(received).toHaveLength(2);
		const after = await reload();
		expect(after).toMatchObject({
			enabled: true,
			failureCount: 1,
			rejectionCount: 1,
			deliveredCount: DATA_STREAM_BATCH_SIZE,
			cursorId: batch[DATA_STREAM_BATCH_SIZE - 1],
		});
		expect(
			dataStreamRetryAt(after)!.getTime() - after.lastErrorAt!.getTime(),
		).toBe(60_000);
	});

	test("stops between live batches once the organization loses access", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(ids("v", DATA_STREAM_BATCH_SIZE * 2), old);
		const stream = await seedStream(new Date(old.getTime() - 1000));

		const result = await runDataStream(stream, {
			onProgress: async () => {
				await db
					.update(tables.organization)
					.set({ dataStreamsEnabled: false })
					.where(eq(tables.organization.id, ORG_ID));
			},
		});
		expect(result).toEqual({ delivered: DATA_STREAM_BATCH_SIZE });
		expect(received).toHaveLength(1);
	});

	test("stops between replay batches once the organization loses access", async () => {
		const old = new Date(Date.now() - ONE_HOUR_MS);
		await seedAudit(ids("rv", DATA_STREAM_BATCH_SIZE * 2), old);
		await seedStream(new Date());
		await db
			.update(tables.dataStream)
			.set({
				replayFrom: new Date(old.getTime() - 1000),
				replayTo: new Date(old.getTime() + 1000),
			})
			.where(eq(tables.dataStream.id, STREAM_ID));

		const result = await runDataStream(await reload(), {
			onProgress: async () => {
				await db
					.update(tables.organization)
					.set({ plan: "pro" })
					.where(eq(tables.organization.id, ORG_ID));
			},
		});
		expect(result).toEqual({ delivered: DATA_STREAM_BATCH_SIZE });
		expect(received).toHaveLength(1);
	});

	test("waits for an open insert transaction instead of skipping its row", async () => {
		const stream = await seedStream(new Date(Date.now() - TEN_MINUTES_MS));
		const row = (id: string) => ({
			id,
			organizationId: ORG_ID,
			userId: USER_ID,
			action: "project.create" as const,
			resourceType: "project" as const,
			resourceId: `resource-${id}`,
		});
		let commit!: () => void;
		const held = new Promise<void>((resolve) => (commit = resolve));
		let markInserted!: () => void;
		const inserted = new Promise<void>((resolve) => (markInserted = resolve));
		const open = db.transaction(async (tx) => {
			await tx.insert(tables.auditLog).values(row("late"));
			markInserted();
			await held;
		});
		await inserted;
		const later = new Date(Date.now() + TEN_MINUTES_MS);
		try {
			await db.insert(tables.auditLog).values(row("committed-first"));
			await runDataStream(stream, { now: later });
		} finally {
			commit();
			await open;
		}
		await new Promise((resolve) => setTimeout(resolve, 1100));
		await runDataStream(await reload(), { now: later });

		const delivered = received.flatMap((r) => r.body.events.map((e) => e.id));
		expect(delivered.sort()).toEqual(["committed-first", "late"]);
	});

	test("replays rows from the last minute before the live cursor", async () => {
		const now = Date.now();
		await seedAudit(["recent-1"], new Date(now - 20_000));
		await seedAudit(["recent-2"], new Date(now - 10_000));
		await seedStream(new Date(now));
		await db
			.update(tables.dataStream)
			.set({
				replayFrom: new Date(now - TEN_MINUTES_MS),
				replayTo: new Date(now - 5_000),
			})
			.where(eq(tables.dataStream.id, STREAM_ID));

		expect((await runDataStream(await reload())).delivered).toBe(2);
		expect((await reload()).replayFrom).toBeNull();
	});

	test("keeps a replay pending until its end is exportable", async () => {
		const now = Date.now();
		await seedAudit(["pending-1"], new Date(now - 20_000));
		await seedStream(new Date(now));
		await db
			.update(tables.dataStream)
			.set({
				replayFrom: new Date(now - TEN_MINUTES_MS),
				replayTo: new Date(now + TEN_MINUTES_MS),
			})
			.where(eq(tables.dataStream.id, STREAM_ID));

		expect((await runDataStream(await reload())).delivered).toBe(1);
		const pending = await reload();
		expect(pending.replayFrom).not.toBeNull();
		expect(pending.replayCursorId).toBe("pending-1");
		expect((await runDataStream(pending)).delivered).toBe(0);
		expect((await reload()).replayFrom).not.toBeNull();
	});

	test("a run without its lease cannot write stream state", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["l1"], old);
		const stream = await seedStream(new Date(old.getTime() - 1000));

		await runDataStream(stream, { leaseId: "data-stream-spec-lost-lease" });
		const unowned = await reload();
		expect(unowned.cursorId).toBe("");
		expect(unowned.deliveredCount).toBe(0);
		status = 500;
		await runDataStream(unowned, { leaseId: "data-stream-spec-lost-lease" });
		expect((await reload()).failureCount).toBe(0);

		status = 200;
		const [lease] = await db
			.insert(tables.lock)
			.values({ key: "data-stream-spec-lease" })
			.returning();
		try {
			await runDataStream(await reload(), { leaseId: lease.id });
			expect((await reload()).cursorId).toBe("l1");
		} finally {
			await db.delete(tables.lock).where(eq(tables.lock.id, lease.id));
		}
	});

	test("replays a past window without moving the live cursor", async () => {
		const old = new Date(Date.now() - ONE_HOUR_MS);
		await seedAudit(["r1", "r2"], old);
		const stream = await seedStream(new Date());
		await db
			.update(tables.dataStream)
			.set({
				replayFrom: new Date(old.getTime() - 1000),
				replayTo: new Date(old.getTime() + 1000),
			})
			.where(eq(tables.dataStream.id, STREAM_ID));

		const result = await runDataStream(await reload());
		expect(result.delivered).toBe(2);
		const after = await reload();
		expect(after.replayFrom).toBeNull();
		expect(after.cursorCreatedAt).toBe(stream.cursorCreatedAt);
	});

	test("keeps a replay window scheduled while a run is in progress", async () => {
		const old = new Date(Date.now() - ONE_HOUR_MS);
		await seedAudit(["w1"], old);
		await seedStream(new Date());
		const next = {
			replayFrom: new Date(old.getTime() - ONE_HOUR_MS),
			replayTo: new Date(old.getTime() - TEN_MINUTES_MS),
		};
		await db
			.update(tables.dataStream)
			.set(next)
			.where(eq(tables.dataStream.id, STREAM_ID));

		// The run started from a snapshot holding the previous window.
		const running = {
			...(await reload()),
			replayFrom: new Date(old.getTime() - 1000),
			replayTo: new Date(old.getTime() + 1000),
		};
		expect((await runDataStream(running)).delivered).toBe(1);
		const after = await reload();
		expect(after.replayFrom).toEqual(next.replayFrom);
		expect(after.replayTo).toEqual(next.replayTo);
	});
});

describe("data stream formatting", () => {
	test("signature has the platform webhook shape", () => {
		expect(signDataStreamPayload("{}", "secret", 1700000000)).toMatch(
			/^t=1700000000,v1=[0-9a-f]{64}$/,
		);
	});

	test("request log events carry metadata only", () => {
		const row = {
			id: "log-1",
			requestId: "req-1",
			createdAt: new Date("2026-01-01T00:00:00Z"),
			organizationId: "org",
			projectId: "project",
			apiKeyId: "key",
			requestedModel: "gpt-4o-mini",
			requestedProvider: null,
			usedModel: "openai/gpt-4o-mini",
			usedProvider: "openai",
			duration: 120,
			timeToFirstToken: null,
			promptTokens: "10",
			completionTokens: "5",
			totalTokens: "15",
			reasoningTokens: null,
			cachedTokens: null,
			cost: 0.0001,
			finishReason: "stop",
			unifiedFinishReason: "completed",
			hasError: false,
			errorCategory: null,
			cached: false,
			streamed: false,
			source: null,
			apiOrigin: null,
			sessionId: null,
		} satisfies RequestLogRow;
		const event = formatRequestLogEvent(row);
		expect(event.totalTokens).toBe(15);
		expect(Object.keys(event)).not.toContain("messages");
		expect(Object.keys(event)).not.toContain("content");
	});

	test("validates destinations", () => {
		const previous = process.env.ALLOW_INSECURE_PROVIDER_URLS;
		delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		try {
			expect(() =>
				validateDataStreamConfig(
					"webhook",
					{ url: "http://x.example" },
					{ signingSecret: SIGNING_SECRET },
				),
			).toThrow("https");
			expect(() =>
				validateDataStreamConfig(
					"webhook",
					{ url: "https://x.example" },
					{ signingSecret: "short" },
				),
			).toThrow("16 characters");
			expect(() =>
				validateDataStreamConfig(
					"webhook",
					{ url: "https://x.example" },
					{ signingSecret: SIGNING_SECRET },
				),
			).not.toThrow();
		} finally {
			if (previous !== undefined) {
				process.env.ALLOW_INSECURE_PROVIDER_URLS = previous;
			}
		}
	});
});
