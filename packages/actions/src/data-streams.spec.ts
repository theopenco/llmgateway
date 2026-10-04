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

import { db, eq, tables } from "@llmgateway/db";

import { listActiveDataStreams, runDataStream } from "./data-stream-runner.js";
import {
	buildS3PutRequest,
	encryptDataStreamSecret,
	formatRequestLogEvent,
	signDataStreamPayload,
	trimSlashes,
	capDataStreamEvent,
	chunkDataStreamEvents,
	validateDataStreamConfig,
	type RequestLogRow,
} from "./data-streams.js";

const ORG_ID = "data-stream-spec-org";
const USER_ID = "data-stream-spec-user";
const STREAM_ID = "data-stream-spec-stream";
const TEN_MINUTES_MS = 600_000;
const ONE_HOUR_MS = 3_600_000;
const SIGNING_SECRET = ["whsec", "spec", "0123456789abcdef"].join("_");

interface Received {
	body: { events: { id: string; action?: string }[] };
	signature: string;
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
		});
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Data Stream Spec Org",
			billingEmail: "data-stream-spec@example.com",
			plan: "enterprise",
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

	async function seedStream(cursorCreatedAt: Date) {
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
					{ signingSecret: SIGNING_SECRET },
					STREAM_ID,
					ORG_ID,
				),
				cursorCreatedAt,
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
		await seedAudit(["fresh"], new Date());
		const stream = await seedStream(new Date(old.getTime() - 1000));

		const first = await runDataStream(stream);
		expect(first).toEqual({ delivered: 2 });
		expect(received).toHaveLength(1);
		expect(received[0].body.events.map((event) => event.id)).toEqual([
			"a1",
			"a2",
		]);
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

	test("keeps the cursor and records the error when delivery fails", async () => {
		const old = new Date(Date.now() - TEN_MINUTES_MS);
		await seedAudit(["b1"], old);
		const stream = await seedStream(new Date(old.getTime() - 1000));
		status = 500;

		const result = await runDataStream(stream);
		expect(result.error).toContain("500");
		const failed = await reload();
		expect(failed.cursorId).toBe("");
		expect(failed.lastError).toContain("500");

		status = 200;
		expect(await runDataStream(failed)).toEqual({ delivered: 1 });
		expect((await reload()).lastError).toBeNull();
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

	test("skips streams of organizations without Enterprise access", async () => {
		await seedStream(new Date());
		expect(
			(await listActiveDataStreams()).some((s) => s.id === STREAM_ID),
		).toBe(true);
		await db
			.update(tables.organization)
			.set({ plan: "pro" })
			.where(eq(tables.organization.id, ORG_ID));
		expect(
			(await listActiveDataStreams()).some((s) => s.id === STREAM_ID),
		).toBe(false);
		await db
			.update(tables.organization)
			.set({ plan: "enterprise", status: "deleted" })
			.where(eq(tables.organization.id, ORG_ID));
		expect(
			(await listActiveDataStreams()).some((s) => s.id === STREAM_ID),
		).toBe(false);
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
		expect(after.cursorCreatedAt.getTime()).toBe(
			stream.cursorCreatedAt.getTime(),
		);
	});
});

describe("data stream formatting", () => {
	test("caps oversized events and chunks by size", () => {
		const big = {
			id: "big",
			type: "request_log" as const,
			timestamp: "2026-01-01T00:00:00Z",
			messages: "x".repeat(2_000_000),
			content: "y".repeat(10),
			usedModel: "m",
		};
		const capped = capDataStreamEvent(big);
		expect(capped.truncated).toBe(true);
		expect(capped).not.toHaveProperty("messages");
		expect(capped.usedModel).toBe("m");
		const small = { id: "s", type: "audit_log" as const, timestamp: "t" };
		expect(capDataStreamEvent(small)).toBe(small);
		const events = Array.from({ length: 10 }, (_, i) => ({
			id: String(i),
			type: "request_log" as const,
			timestamp: "t",
			content: "z".repeat(500_000),
		}));
		const chunks = chunkDataStreamEvents(events);
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.flat()).toHaveLength(10);
		for (const chunk of chunks) {
			expect(Buffer.byteLength(JSON.stringify(chunk))).toBeLessThan(4_000_000);
		}
	});

	test("trimSlashes trims without regex backtracking", () => {
		expect(trimSlashes("//a/b//")).toBe("a/b");
		expect(trimSlashes("https://x.example///", { end: true })).toBe(
			"https://x.example",
		);
		expect(trimSlashes("/".repeat(100_000))).toBe("");
	});

	test("signature has the platform webhook shape", () => {
		expect(signDataStreamPayload("{}", "secret", 1700000000)).toMatch(
			/^t=1700000000,v1=[0-9a-f]{64}$/,
		);
	});

	test("request log events omit payloads unless opted in", () => {
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
			messages: [{ role: "user", content: "secret prompt" }],
			content: "secret answer",
		} satisfies RequestLogRow;
		const lean = formatRequestLogEvent(row, false);
		expect(lean).not.toHaveProperty("messages");
		expect(lean.totalTokens).toBe(15);
		expect(formatRequestLogEvent(row, true).content).toBe("secret answer");
	});

	test("S3 requests are SigV4 signed for the bucket host", () => {
		const request = buildS3PutRequest(
			{
				bucket: "logs-bucket",
				region: "eu-central-1",
				accessKeyId: ["AKIA", "SPECKEY"].join(""),
			},
			["spec", "secret"].join("-"),
			"llmgateway/request_logs/2026-01-01/1.ndjson",
			"{}",
			new Date("2026-01-01T00:00:00Z"),
		);
		expect(request.url).toBe(
			"https://logs-bucket.s3.eu-central-1.amazonaws.com/llmgateway/request_logs/2026-01-01/1.ndjson",
		);
		expect(request.headers.Authorization).toMatch(
			/^AWS4-HMAC-SHA256 Credential=AKIASPECKEY\/20260101\/eu-central-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
		);
	});

	test("validates destinations", () => {
		const previous = process.env.ALLOW_INSECURE_PROVIDER_URLS;
		delete process.env.ALLOW_INSECURE_PROVIDER_URLS;
		try {
			expect(() =>
				validateDataStreamConfig(
					"datadog",
					{ site: "evil.example" },
					{ apiKey: "k" },
				),
			).toThrow("Unsupported Datadog site");
			expect(() =>
				validateDataStreamConfig(
					"webhook",
					{ url: "http://x.example" },
					{
						signingSecret: SIGNING_SECRET,
					},
				),
			).toThrow("https");
			expect(() =>
				validateDataStreamConfig(
					"splunk",
					{ url: "https://splunk.example" },
					{
						token: "t",
					},
				),
			).not.toThrow();
		} finally {
			if (previous !== undefined) {
				process.env.ALLOW_INSECURE_PROVIDER_URLS = previous;
			}
		}
	});
});
