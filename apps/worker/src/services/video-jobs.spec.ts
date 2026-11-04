import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { processPendingVideoJobs } from "./video-jobs.js";

const projectId = "video-billing-project";
const organizationId = "video-billing-org";
const apiKeyId = "video-billing-key";
const providerKeyId = "video-billing-provider-key";
const userId = "video-billing-user";
const jobId = "video-billing-job";
const fetchMock = vi.fn<typeof fetch>();

async function cleanup() {
	await db
		.delete(tables.webhookDeliveryLog)
		.where(eq(tables.webhookDeliveryLog.videoJobId, jobId));
	await db.delete(tables.videoJob).where(eq(tables.videoJob.id, jobId));
	await db.delete(tables.log).where(eq(tables.log.projectId, projectId));
	await db.delete(tables.apiKey).where(eq(tables.apiKey.id, apiKeyId));
	await db
		.delete(tables.providerKey)
		.where(eq(tables.providerKey.id, providerKeyId));
	await db.delete(tables.project).where(eq(tables.project.id, projectId));
	await db
		.delete(tables.organization)
		.where(eq(tables.organization.id, organizationId));
	await db.delete(tables.user).where(eq(tables.user.id, userId));
}

beforeEach(async () => {
	await cleanup();
	await db
		.insert(tables.user)
		.values({ id: userId, email: "video-billing@example.com" });
	await db.insert(tables.organization).values({
		id: organizationId,
		name: "Test Organization",
		billingEmail: "video-billing@example.com",
		retentionLevel: "retain",
	});
	await db
		.insert(tables.project)
		.values({ id: projectId, name: "Video billing", organizationId });
	await db.insert(tables.apiKey).values({
		id: apiKeyId,
		...hashApiKeyForStorage("test-token"),
		projectId,
		createdBy: userId,
		description: "Test key",
	});
	fetchMock.mockReset();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await cleanup();
});

async function createJob(
	options: {
		model?: string;
		provider?: string;
		resolution?: string;
		includeAudio?: boolean;
		hasVideoInput?: boolean;
		duration?: number;
		requestedResolution?: string;
	} = {},
) {
	const provider = options.provider ?? "bytedance";
	await db.insert(tables.providerKey).values({
		id: providerKeyId,
		...encryptProviderKeyForStorage(
			"test-token",
			providerKeyId,
			organizationId,
		),
		provider,
		organizationId,
	});
	await db.insert(tables.videoJob).values({
		id: jobId,
		requestId: "video-billing-request",
		organizationId,
		projectId,
		apiKeyId,
		providerKeyId,
		mode: "api-keys",
		usedMode: "api-keys",
		model: options.model ?? "seedance-2-0",
		usedProvider: provider,
		usedModel: options.model ?? "seedance-2-0",
		upstreamId: "upstream-video-job",
		prompt: "A test video",
		nextPollAt: new Date(0),
		upstreamCreateResponse: {
			llmgateway_requested_size: "1280x720",
			llmgateway_requested_resolution: options.requestedResolution ?? "720p",
			llmgateway_requested_duration_seconds: options.duration ?? 4,
			llmgateway_upstream_request: {
				resolution: options.resolution ?? "720p",
				generate_audio: options.includeAudio ?? true,
				content: options.hasVideoInput
					? [
							{
								type: "video_url",
								video_url: { url: "https://example.com/reference.mp4" },
							},
						]
					: [{ type: "text", text: "A test video" }],
			},
		},
	});
}

function respond(body: Record<string, unknown>) {
	fetchMock.mockImplementation(async () => Response.json(body));
}

async function pollAndRead() {
	await processPendingVideoJobs();
	return {
		job: await db.query.videoJob.findFirst({ where: { id: jobId } }),
		logs: await db.query.log.findMany({ where: { projectId } }),
	};
}

describe("video job token billing", () => {
	test("bills exact completion tokens, including consumption above duration estimates", async () => {
		await createJob();
		respond({
			status: "succeeded",
			resolution: "720p",
			duration: 4.04,
			usage: { completion_tokens: 120001 },
		});
		const { job, logs } = await pollAndRead();
		expect(job?.status).toBe("completed");
		expect(job?.videoOutputCost).toBeCloseTo(0.840007, 6);
		expect(logs).toHaveLength(1);
		expect(logs[0].completionTokens).toBe("120001");
		expect(logs[0].cost).toBeCloseTo(0.840007, 6);
	});
});
const seedanceRates = [
	["seedance-2-5", "720p", "10.7e-6", "6.4e-6"],
	["seedance-2-5", "1080p", "11.7e-6", "7e-6"],
	["seedance-2-0", "720p", "7e-6", "4.3e-6"],
	["seedance-2-0", "1080p", "7.7e-6", "4.7e-6"],
	["seedance-2-0", "4k", "4e-6", "2.4e-6"],
	["seedance-2-0-fast", "720p", "5.6e-6", "3.3e-6"],
	["seedance-2-0-mini", "480p", "3.5e-6", "2.1e-6"],
	["seedance-2-0-mini", "720p", "3.5e-6", "2.1e-6"],
] as const;

const rateCases = seedanceRates.flatMap(
	([model, resolution, withoutVideo, withVideo]) =>
		[false, true].flatMap((hasVideoInput) =>
			[false, true].map((includeAudio) => ({
				model,
				resolution,
				hasVideoInput,
				includeAudio,
				price: hasVideoInput ? withVideo : withoutVideo,
			})),
		),
);

for (const resolution of ["480p", "720p", "1080p"]) {
	for (const includeAudio of [false, true]) {
		for (const hasVideoInput of [false, true]) {
			test(`Seedance 1.5 ${resolution}, audio=${includeAudio}, video input=${hasVideoInput}`, async () => {
				await createJob({
					model: "seedance-1-5-pro",
					resolution,
					includeAudio,
					hasVideoInput,
				});
				respond({
					status: "succeeded",
					resolution,
					generate_audio: !includeAudio,
					usage: { completion_tokens: 100003 },
				});
				const { job, logs } = await pollAndRead();
				const expected = new Decimal(100003)
					.mul(includeAudio ? "2.4e-6" : "1.2e-6")
					.toDecimalPlaces(6)
					.toNumber();
				expect(job?.cost).toBeCloseTo(expected, 6);
				expect(logs[0]?.completionTokens).toBe("100003");
			});
		}
	}
}

test.each(rateCases)(
	"$model $resolution, audio=$includeAudio, video input=$hasVideoInput",
	async ({ model, resolution, includeAudio, hasVideoInput, price }) => {
		await createJob({ model, resolution, includeAudio, hasVideoInput });
		respond({
			status: "succeeded",
			resolution,
			usage: { completion_tokens: 100003 },
		});
		const { job, logs } = await pollAndRead();
		const expected = new Decimal(100003)
			.mul(price)
			.toDecimalPlaces(6)
			.toNumber();
		expect(job?.cost).toBeCloseTo(expected, 6);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			completionTokens: "100003",
			inputCost: 0,
			outputCost: 0,
			estimatedCost: false,
		});
		expect(logs[0].videoOutputCost).toBeCloseTo(expected, 6);
		expect(logs[0].cost).toBeCloseTo(expected, 6);
	},
);

test.each([4, 4.04, 4.9999, 9.9999])(
	"duration %s does not replace or round provider token usage",
	async (duration) => {
		await createJob({ duration });
		respond({
			status: "succeeded",
			duration,
			usage: { completion_tokens: 120001 },
		});
		const { job } = await pollAndRead();
		expect(job?.cost).toBeCloseTo(0.840007, 6);
	},
);

test.each([
	{ returned: "1080p", persisted: "720p", requested: "4k", nested: false },
	{ returned: "1080p", persisted: "720p", requested: "4k", nested: true },
	{ returned: undefined, persisted: "1080p", requested: "720p", nested: false },
])(
	"uses actual then persisted resolution: %j",
	async ({ returned, persisted, requested, nested }) => {
		await createJob({ resolution: persisted, requestedResolution: requested });
		const status = {
			status: "succeeded",
			resolution: returned,
			usage: { completion_tokens: 100000 },
		};
		respond(nested ? { data: status } : status);
		const { job } = await pollAndRead();
		expect(job?.cost).toBeCloseTo(0.77, 6);
	},
);

test("uses requested metadata only when upstream resolution is absent", async () => {
	await createJob({ requestedResolution: "1080p" });
	await db
		.update(tables.videoJob)
		.set({
			upstreamCreateResponse: {
				llmgateway_requested_size: "1920x1080",
				llmgateway_requested_resolution: "1080p",
				llmgateway_requested_duration_seconds: 4,
				llmgateway_upstream_request: { generate_audio: false, content: [] },
			},
		})
		.where(eq(tables.videoJob.id, jobId));
	respond({ status: "succeeded", usage: { completion_tokens: 100000 } });
	const { job } = await pollAndRead();
	expect(job?.cost).toBeCloseTo(0.77, 6);
});

test("does not infer discounted video input from caller or status metadata", async () => {
	await createJob();
	const job = (await db.query.videoJob.findFirst({ where: { id: jobId } })) as {
		upstreamCreateResponse: Record<string, unknown>;
	};
	await db
		.update(tables.videoJob)
		.set({
			upstreamCreateResponse: {
				...job?.upstreamCreateResponse,
				llmgateway_raw_request: {
					reference_videos: ["https://example.com/reference.mp4"],
				},
			},
		})
		.where(eq(tables.videoJob.id, jobId));
	respond({
		status: "succeeded",
		content: [{ type: "video_url" }],
		usage: { completion_tokens: 100000 },
	});
	expect((await pollAndRead()).job?.cost).toBeCloseTo(0.7, 6);
});

const invalidUsage = [
	undefined,
	null,
	{},
	[],
	{ completion_tokens: 0 },
	{ completion_tokens: -1 },
	{ completion_tokens: 1.5 },
	{ completion_tokens: "100000" },
	{ completion_tokens: Number.MAX_SAFE_INTEGER + 1 },
];

test.each(invalidUsage)(
	"defers invalid usage %j without finalizing or estimating",
	async (usage) => {
		await createJob();
		respond({ status: "succeeded", usage });
		const { job, logs } = await pollAndRead();
		expect(job).toMatchObject({
			status: "in_progress",
			resultLoggedAt: null,
			logId: null,
			cost: null,
			completedAt: null,
		});
		expect(job?.nextPollAt.getTime()).toBeGreaterThan(Date.now());
		expect(job?.upstreamStatusResponse).toMatchObject({
			llmgateway_billing_pending: true,
			llmgateway_billing_retry_count: 1,
		});
		expect(logs).toHaveLength(0);
	},
);

async function makeDue() {
	const ageMs = 2 * 60 * 60 * 1000;
	await db
		.update(tables.videoJob)
		.set({ nextPollAt: new Date(0), createdAt: new Date(Date.now() - ageMs) })
		.where(eq(tables.videoJob.id, jobId));
}

test("retries missing usage beyond normal timeout/errors, then finalizes exactly once", async () => {
	await createJob();
	await db
		.update(tables.videoJob)
		.set({
			createdAt: new Date(0),
			callbackUrl: "https://example.com/webhook",
			callbackSecret: "test-secret",
			callbackStatus: "pending",
		})
		.where(eq(tables.videoJob.id, jobId));
	respond({ status: "succeeded" });
	for (let attempt = 0; attempt < 6; attempt++) {
		await makeDue();
		const { job, logs } = await pollAndRead();
		expect(job?.status).toBe("in_progress");
		expect(job?.callbackEventId).toBeNull();
		expect(logs).toHaveLength(0);
	}
	fetchMock.mockRejectedValue(new Error("Temporary upstream status outage"));
	await makeDue();
	expect((await pollAndRead()).job?.status).toBe("in_progress");
	respond({ status: "failed", error: { message: "Status unavailable" } });
	await makeDue();
	expect((await pollAndRead()).job?.status).toBe("in_progress");
	respond({ status: "succeeded", usage: { completion_tokens: 100000 } });
	await makeDue();
	const { job, logs } = await pollAndRead();
	expect(job?.status).toBe("completed");
	expect(job?.cost).toBeCloseTo(0.7, 6);
	expect(job?.callbackEventId).toBe(`evt_${jobId}`);
	expect(logs).toHaveLength(1);
	expect((await pollAndRead()).logs).toHaveLength(1);
	expect(
		await db.query.webhookDeliveryLog.findMany({
			where: { videoJobId: jobId },
		}),
	).toHaveLength(1);
});

test("requeues unlogged completed jobs with missing usage for another upstream poll", async () => {
	await createJob();
	await db
		.update(tables.videoJob)
		.set({
			status: "completed",
			upstreamStatusResponse: { status: "succeeded" },
		})
		.where(eq(tables.videoJob.id, jobId));
	expect((await pollAndRead()).job?.status).toBe("in_progress");
	respond({
		data: { status: "succeeded", usage: { completion_tokens: 100000 } },
	});
	await makeDue();
	const { job, logs } = await pollAndRead();
	expect(job?.status).toBe("completed");
	expect(job?.cost).toBeCloseTo(0.7, 6);
	expect(logs).toHaveLength(1);
});

test("defers a missing token price rather than using seconds", async () => {
	await createJob({ model: "test-unknown-video-model" });
	respond({ status: "succeeded", usage: { completion_tokens: 100000 } });
	const { job, logs } = await pollAndRead();
	expect(job?.status).toBe("in_progress");
	expect(job?.cost).toBeNull();
	expect(logs).toHaveLength(0);
});

test.each([true, false])(
	"preserves Gemini video modality billing without double charging (video tokens=%s)",
	async (hasVideoTokens) => {
		await createJob({
			model: "gemini-omni-1.1-flash",
			provider: "google-ai-studio",
		});
		respond({
			status: "completed",
			steps: [
				{
					type: "model_output",
					content: [
						{ type: "video", data: "dGVzdA==", mime_type: "video/mp4" },
					],
				},
			],
			usage: {
				total_input_tokens: 200,
				total_output_tokens: hasVideoTokens ? 1100 : 100,
				total_thought_tokens: 50,
				output_tokens_by_modality: hasVideoTokens
					? [
							{ modality: "video", tokens: 1000 },
							{ modality: "text", tokens: 100 },
						]
					: [],
			},
		});
		const { job, logs } = await pollAndRead();
		expect(job?.status).toBe("completed");
		expect(job?.videoOutputCost).toBeCloseTo(
			hasVideoTokens ? 0.0175 : 0.40544,
			6,
		);
		expect(job?.cost).toBeCloseTo(hasVideoTokens ? 0.01915 : 0.40709, 6);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toMatchObject({
			promptTokens: "200",
			completionTokens: "100",
			reasoningTokens: "50",
		});
		expect((await pollAndRead()).logs).toHaveLength(1);
	},
);
test.each(["retain", "none"] as const)(
	"bills non-debug %s jobs from minimal trusted metadata",
	async (retentionLevel) => {
		await createJob({ model: "seedance-1-5-pro" });
		await db
			.update(tables.organization)
			.set({ retentionLevel })
			.where(eq(tables.organization.id, organizationId));
		await db
			.update(tables.videoJob)
			.set({
				upstreamCreateResponse: {
					llmgateway_requested_size: "1280x720",
					llmgateway_requested_duration_seconds: 4,
					llmgateway_video_token_pricing: {
						resolution: "1080p",
						includeAudio: false,
						hasVideoInput: false,
					},
				},
			})
			.where(eq(tables.videoJob.id, jobId));
		respond({
			status: "succeeded",
			generate_audio: true,
			usage: { completion_tokens: 100000 },
		});
		const { job, logs } = await pollAndRead();
		expect(job?.cost).toBeCloseTo(0.12, 6);
		expect(logs).toHaveLength(1);
		expect(logs[0].completionTokens).toBe("100000");
		expect(logs[0].upstreamRequest).toBeNull();
	},
);

test("uses persisted minimal reference metadata and ignores provider-supplied billing metadata", async () => {
	await createJob();
	await db
		.update(tables.videoJob)
		.set({
			upstreamCreateResponse: {
				llmgateway_requested_size: "1280x720",
				llmgateway_requested_duration_seconds: 4,
				llmgateway_video_token_pricing: {
					resolution: "1080p",
					includeAudio: false,
					hasVideoInput: true,
				},
			},
		})
		.where(eq(tables.videoJob.id, jobId));
	respond({
		status: "succeeded",
		usage: { completion_tokens: 100000 },
		llmgateway_video_token_pricing: {
			resolution: "720p",
			includeAudio: true,
			hasVideoInput: false,
		},
		llmgateway_upstream_request: {
			content: [],
			generate_audio: true,
			resolution: "720p",
		},
	});
	expect((await pollAndRead()).job?.cost).toBeCloseTo(0.47, 6);
});

test("defers legacy jobs without trusted billing input metadata", async () => {
	await createJob();
	await db
		.update(tables.videoJob)
		.set({
			upstreamCreateResponse: {
				llmgateway_requested_size: "1280x720",
				llmgateway_requested_duration_seconds: 4,
			},
		})
		.where(eq(tables.videoJob.id, jobId));
	respond({
		status: "succeeded",
		usage: { completion_tokens: 100000 },
		llmgateway_upstream_request: { content: [], generate_audio: true },
	});
	const { job, logs } = await pollAndRead();
	expect(job?.status).toBe("in_progress");
	expect(logs).toHaveLength(0);
});
function createGate() {
	let release = () => {};
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}

function pauseFinalization() {
	const reached = createGate();
	const resume = createGate();
	const transaction = db.transaction.bind(db);
	let calls = 0;
	const spy = vi
		.spyOn(db, "transaction")
		.mockImplementation(async (callback, config) => {
			if (++calls === 2) {
				reached.release();
				await resume.promise;
			}
			return await transaction(callback, config);
		});
	return { reached, resume, spy };
}

async function testStaleBillingDeferralRace() {
	await createJob();
	await db
		.update(tables.videoJob)
		.set({
			status: "completed",
			upstreamStatusResponse: { status: "succeeded" },
			callbackUrl: "https://example.com/webhook",
			callbackSecret: "test-secret",
			callbackStatus: "pending",
		})
		.where(eq(tables.videoJob.id, jobId));
	const staleDeferralReached = createGate();
	const resumeStaleDeferral = createGate();
	const update = db.update.bind(db);
	let interceptDeferral = true;
	const updateSpy = vi.spyOn(db, "update").mockImplementation(((
		table: Parameters<typeof db.update>[0],
	) => {
		const builder = update(table);
		const set = builder.set.bind(builder);
		vi.spyOn(builder, "set").mockImplementation((values) => {
			const query = set(values);
			if (
				table === tables.videoJob &&
				"status" in values &&
				values.status === "in_progress" &&
				interceptDeferral
			) {
				interceptDeferral = false;
				const execute = query.execute.bind(query);
				vi.spyOn(query, "execute").mockImplementation(async (...args) => {
					staleDeferralReached.release();
					await resumeStaleDeferral.promise;
					return await execute(...args);
				});
			}
			return query;
		});
		return builder;
	}) as typeof db.update);
	const staleWorker = processPendingVideoJobs();
	let currentWorker: Promise<void> | undefined;
	let finalization: ReturnType<typeof pauseFinalization> | undefined;
	try {
		await staleDeferralReached.promise;
		await processPendingVideoJobs();
		await makeDue();
		respond({ status: "succeeded", usage: { completion_tokens: 100000 } });
		finalization = pauseFinalization();
		currentWorker = processPendingVideoJobs();
		await finalization.reached.promise;
		resumeStaleDeferral.release();
		await staleWorker;
		const beforeClaim = await db.query.videoJob.findFirst({
			where: { id: jobId },
		});
		expect(beforeClaim).toMatchObject({
			status: "completed",
			pollAttemptCount: 2,
			resultLoggedAt: null,
			callbackEventId: null,
		});
		expect(beforeClaim?.upstreamStatusResponse).toMatchObject({
			usage: { completion_tokens: 100000 },
		});
	} finally {
		resumeStaleDeferral.release();
		finalization?.resume.release();
		await staleWorker;
		await currentWorker;
		finalization?.spy.mockRestore();
		updateSpy.mockRestore();
	}
	const { job, logs } = await pollAndRead();
	expect(job?.status).toBe("completed");
	expect(job?.cost).toBeCloseTo(0.7, 6);
	expect(logs).toHaveLength(1);
	expect(logs[0].hasError).toBe(false);
	expect(logs[0].cost).toBeCloseTo(0.7, 6);
	const deliveries = await db.query.webhookDeliveryLog.findMany({
		where: { videoJobId: jobId },
	});
	expect(deliveries).toHaveLength(1);
	expect(deliveries[0].eventType).toBe("video.completed");
}

test(
	"a stale terminal deferral cannot overwrite a successful poll before its billing claim",
	testStaleBillingDeferralRace,
);

async function testLostTerminalClaim() {
	await createJob();
	await db
		.update(tables.videoJob)
		.set({
			status: "completed",
			upstreamStatusResponse: {
				status: "succeeded",
				usage: { completion_tokens: 100000 },
			},
			callbackUrl: "https://example.com/webhook",
			callbackSecret: "test-secret",
			callbackStatus: "pending",
		})
		.where(eq(tables.videoJob.id, jobId));
	const finalization = pauseFinalization();
	const worker = processPendingVideoJobs();
	try {
		await finalization.reached.promise;
		await db
			.update(tables.videoJob)
			.set({ status: "in_progress", pollAttemptCount: 1 })
			.where(eq(tables.videoJob.id, jobId));
	} finally {
		finalization.resume.release();
		await worker;
		finalization.spy.mockRestore();
	}
	const job = await db.query.videoJob.findFirst({ where: { id: jobId } });
	expect(job).toMatchObject({
		status: "in_progress",
		resultLoggedAt: null,
		logId: null,
		cost: null,
		callbackEventId: null,
	});
	expect(await db.query.log.findMany({ where: { projectId } })).toHaveLength(0);
	expect(
		await db.query.webhookDeliveryLog.findMany({
			where: { videoJobId: jobId },
		}),
	).toHaveLength(0);
}

test(
	"a lost terminal billing claim creates neither a free failure log nor a stale callback",
	testLostTerminalClaim,
);
