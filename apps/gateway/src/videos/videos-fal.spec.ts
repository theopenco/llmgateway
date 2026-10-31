import { createServer } from "node:http";

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";
import { processPendingVideoJobs } from "worker";

import { app } from "@/app.js";
import { createGatewayApiTestHarness } from "@/test-utils/gateway-api-test-harness.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import type { AddressInfo } from "node:net";

describe("native fal video queue", () => {
	createGatewayApiTestHarness();
	let baseUrl: string;
	let queueStatus: string;
	let statusCode: number;
	let resultCode: number;
	let result: Record<string, unknown>;
	let requests: Array<{
		path: string;
		method: string;
		body: Record<string, unknown>;
		hasKeyAuth: boolean;
		hasAuth: boolean;
	}>;
	const headers = {
		"Content-Type": "application/json",
		Authorization: "Bearer fal-test-token",
		"x-no-fallback": "true",
	};
	const image = "data:image/png;base64,aGVsbG8=";
	const server = createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const chunk of req) {
			chunks.push(Buffer.from(chunk));
		}
		const text = Buffer.concat(chunks).toString();
		const path = req.url ?? "/";
		requests.push({
			path,
			method: req.method ?? "GET",
			body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
			hasKeyAuth: req.headers.authorization?.startsWith("Key ") ?? false,
			hasAuth: Boolean(req.headers.authorization),
		});
		res.setHeader("Content-Type", "application/json");
		if (req.method === "POST") {
			res.end(
				JSON.stringify({
					status: "IN_QUEUE",
					request_id: "fal-request",
					status_url: "https://attacker.invalid/stolen/status",
					response_url: "https://attacker.invalid/stolen",
					cancel_url: "https://attacker.invalid/cancel",
				}),
			);
		} else if (path.endsWith("/status")) {
			res.statusCode = statusCode;
			res.end(
				JSON.stringify({
					status: queueStatus,
					response_url: "https://attacker.invalid/stolen",
				}),
			);
		} else if (path.endsWith("/requests/fal-request")) {
			res.statusCode = resultCode;
			res.end(JSON.stringify(result));
		} else if (path === "/asset.mp4") {
			res.setHeader("Content-Type", "video/mp4");
			res.end("mock-mp4");
		} else {
			res.statusCode = 404;
			res.end("{}");
		}
	});

	beforeAll(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterAll(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
	});
	beforeEach(async () => {
		requests = [];
		queueStatus = "IN_QUEUE";
		statusCode = 200;
		resultCode = 200;
		// Real fal 720p output has a rounded height and one extra frame. Bill
		// the requested integer duration, not ceil(video.duration).
		result = {
			video: {
				url: `${baseUrl}/asset.mp4`,
				content_type: "video/mp4",
				width: 1280,
				height: 704,
				duration: 5.041666666666667,
				num_frames: 121,
			},
			seed: 1,
		};
		await db.insert(tables.apiKey).values({
			id: "fal-token",
			...hashApiKeyForStorage("fal-test-token"),
			projectId: "project-id",
			description: "Fal mock",
			createdBy: "user-id",
		});
		await db.insert(tables.providerKey).values({
			id: "fal-key",
			...encryptProviderKeyForStorage("fal-mock-key", "fal-key", "org-id"),
			provider: "fal-ai",
			organizationId: "org-id",
			baseUrl,
		});
	});

	async function submit(extra: Record<string, unknown> = {}) {
		return await app.request("/v1/videos", {
			method: "POST",
			headers,
			body: JSON.stringify({
				model: "fal-ai/flux-3-max",
				prompt: "A cinematic waterfall",
				seconds: 5,
				size: "1280x720",
				...extra,
			}),
		});
	}
	async function create(extra: Record<string, unknown> = {}) {
		const response = await submit(extra);
		expect(response.status).toBe(200);
		return (await response.json()) as { id: string; status: string };
	}
	async function poll(id: string) {
		await db
			.update(tables.videoJob)
			.set({ nextPollAt: new Date(0) })
			.where(eq(tables.videoJob.id, id));
		await processPendingVideoJobs();
		return await db.query.videoJob.findFirst({ where: { id: { eq: id } } });
	}

	test.each([
		{
			size: "1280x720",
			resolution: "720p",
			ratio: "16:9",
			audio: true,
			effort: undefined,
		},
		{
			size: "720x1280",
			resolution: "720p",
			ratio: "9:16",
			audio: false,
			effort: "low",
		},
		{
			size: "1920x1080",
			resolution: "1080p",
			ratio: "16:9",
			audio: false,
			effort: "high",
		},
		{
			size: "1080x1920",
			resolution: "1080p",
			ratio: "9:16",
			audio: true,
			effort: "low",
		},
	])(
		"POST uses native payload: $size/$effort/$audio",
		async ({ size, resolution, ratio, audio, effort }) => {
			await create({
				size,
				audio,
				...(effort ? { reasoning_effort: effort } : {}),
			});
			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				path: "/blackforestlabs/flux-3-max/text-to-video",
				method: "POST",
				hasKeyAuth: true,
				body: {
					prompt: "A cinematic waterfall",
					duration: 5,
					resolution,
					aspect_ratio: ratio,
					generate_audio: audio,
					reasoning_level: effort ?? "high",
				},
			});
			expect(requests[0].body).not.toHaveProperty("model");
			expect(requests[0].body).not.toHaveProperty("reasoning_effort");
		},
	);

	test.each([
		{ image },
		{ image, last_frame: "data:image/png;base64,d29ybGQ=" },
		{ input_reference: image },
	])(
		"POST image-to-video accepts frames and one reference: %j",
		async (input) => {
			await create(input);
			expect(requests[0]).toMatchObject({
				path: "/blackforestlabs/flux-3-max/image-to-video",
				body: { image_url: image },
			});
			if ("last_frame" in input) {
				expect(requests[0].body.end_image_url).toBe(input.last_frame);
			} else {
				expect(requests[0].body).not.toHaveProperty("end_image_url");
			}
		},
	);

	test.each([
		{ seconds: 4 },
		{ seconds: 21 },
		{ seconds: "5" },
		{ size: "3840x2160" },
		{ reasoning_effort: "medium" },
		{ reference_images: [image, image] },
		{ reference_videos: ["https://example.com/reference.mp4"] },
		{ model: "atlascloud/kling-v3-0", reasoning_effort: "high" },
	])("rejects unsupported parameters without submission: %j", async (input) => {
		const response = await submit(input);
		expect(response.status).toBe(400);
		expect(requests).toHaveLength(0);
	});

	test("polls queue then retrieves actual result at owner/app path and bills requested seconds", async () => {
		const created = await create();
		expect(created.status).toBe("queued");
		expect((await poll(created.id))?.status).toBe("queued");
		queueStatus = "IN_PROGRESS";
		expect((await poll(created.id))?.status).toBe("in_progress");
		expect(
			requests.filter((request) =>
				request.path.endsWith("/requests/fal-request"),
			),
		).toHaveLength(0);
		queueStatus = "COMPLETED";
		const job = await poll(created.id);
		expect(job).toMatchObject({
			status: "completed",
			contentUrl: `${baseUrl}/asset.mp4`,
			contentType: "video/mp4",
		});
		expect(
			requests
				.slice(1)
				.every(
					(request) =>
						request.path.startsWith(
							"/blackforestlabs/flux-3-max/requests/fal-request",
						) && request.hasKeyAuth,
				),
		).toBe(true);
		const logs = await db.query.log.findMany();
		expect(logs).toHaveLength(1);
		expect(logs[0].videoOutputCost).toBeCloseTo(5 * 0.17);
		await poll(created.id);
		expect(
			requests.filter((request) =>
				request.path.endsWith("/requests/fal-request"),
			),
		).toHaveLength(1);
	});

	test("pins a pending-deletion creating key instead of another fal account", async () => {
		const created = await create();
		await db
			.update(tables.providerKey)
			.set({ status: "pending_deletion" })
			.where(eq(tables.providerKey.id, "fal-key"));
		await db.insert(tables.providerKey).values({
			id: "other-fal-key",
			...encryptProviderKeyForStorage(
				"other-fal-mock-key",
				"other-fal-key",
				"org-id",
			),
			provider: "fal-ai",
			organizationId: "org-id",
			baseUrl: `${baseUrl}/other-account`,
		});
		queueStatus = "COMPLETED";
		expect((await poll(created.id))?.status).toBe("completed");
		expect(
			requests
				.slice(1)
				.every((request) => !request.path.includes("other-account")),
		).toBe(true);
	});

	test.each([
		{
			code: 422,
			payload: { detail: [{ type: "literal_error", msg: "Invalid duration" }] },
			expected: "failed",
		},
		{
			code: 400,
			payload: { detail: "Request cancelled" },
			expected: "canceled",
		},
		{ code: 200, payload: { error: "Generation failed" }, expected: "failed" },
		{ code: 200, payload: {}, expected: "failed" },
	])(
		"COMPLETED queue is not success until result: $code/$expected",
		async ({ code, payload, expected }) => {
			const created = await create();
			queueStatus = "COMPLETED";
			resultCode = code;
			result = payload;
			const job = await poll(created.id);
			expect(job?.status).toBe(expected);
			expect(job?.error).toBeTruthy();
			if (code === 422) {
				expect(job?.error?.message).toBe("Invalid duration");
			}
			const logs = await db.query.log.findMany();
			expect(logs).toHaveLength(1);
			expect(logs[0].videoOutputCost).toBe(0);
		},
	);

	test.each(["status", "result"])(
		"transient %s failure backs off, never submits a second charged job",
		async (step) => {
			const created = await create();
			queueStatus = "COMPLETED";
			if (step === "status") {
				statusCode = 503;
			} else {
				resultCode = 503;
			}
			const job = await poll(created.id);
			expect(job?.status).toBe("queued");
			expect(job?.upstreamStatusResponse).toMatchObject({
				llmgateway_poll_error_count: 1,
			});
			expect(
				requests.filter((request) => request.method === "POST"),
			).toHaveLength(1);
			statusCode = resultCode = 200;
			expect((await poll(created.id))?.status).toBe("completed");
		},
	);

	test("streams content without forwarding queue credentials, including signed log content", async () => {
		const created = await create();
		queueStatus = "COMPLETED";
		await poll(created.id);
		const response = await app.request(`/v1/videos/${created.id}/content`, {
			headers,
		});
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("mock-mp4");
		// Check the signed log-content URL exposed by the public serializer too.
		const status = await app.request(`/v1/videos/${created.id}`, { headers });
		const serialized = await status.json();
		const signedUrl = serialized.content?.[0]?.url;
		expect(typeof signedUrl).toBe("string");
		const signed = await app.request(
			new URL(signedUrl).pathname + new URL(signedUrl).search,
		);
		expect(signed.status).toBe(200);
		expect(await signed.text()).toBe("mock-mp4");
		expect(
			requests
				.filter((request) => request.path === "/asset.mp4")
				.every((request) => !request.hasAuth),
		).toBe(true);
	});

	test("worker and downloads reject BYOK private URLs when URL guard is enabled", async () => {
		const created = await create();
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		try {
			expect((await poll(created.id))?.status).toBe("queued");
			expect(requests).toHaveLength(1);
		} finally {
			vi.unstubAllEnvs();
		}
		queueStatus = "COMPLETED";
		await poll(created.id);
		vi.stubEnv("ALLOW_INSECURE_PROVIDER_URLS", "false");
		try {
			const response = await app.request(`/v1/videos/${created.id}/content`, {
				headers,
			});
			expect(response.status).toBe(502);
			expect(requests.some((request) => request.path === "/asset.mp4")).toBe(
				false,
			);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
