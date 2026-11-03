import "dotenv/config";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	logMode,
	matchesTestModel,
	specifiedModels,
} from "@/chat-helpers.e2e.js";
import {
	clearCache,
	waitForLogByRequestId,
} from "@/test-utils/test-helpers.js";

import { runProviderModelVerification } from "@llmgateway/actions";
import { db, eq, tables } from "@llmgateway/db";
import {
	expandAllProviderRegions,
	getProviderDefinition,
	models,
	type ModelDefinition,
	type ProviderApiFormat,
	type ProviderModelMapping,
	type ToolChoiceMode,
} from "@llmgateway/models";

/**
 * Long-context routing against real upstreams. Opt-in (every case sends a
 * prompt of several hundred thousand tokens):
 *
 *   CONTEXT_ROUTING_TEST=true pnpm test:e2e
 *
 * 1. Every deployment of the covered models serves a prompt beyond 262k
 *    tokens when it advertises a ~1M window (and ~half its window otherwise).
 * 2. A deployment far below the model's full window gets no requests for the
 *    bare model id, even as the cheapest candidate and for a short prompt,
 *    while pinning it still works. A long coding-agent session for the bare
 *    id is served by a full-window deployment.
 *
 * 3. Airside preflight fills ~90% of a declared 1M window and passes on a
 *    deployment that serves it.
 *
 * TEST_MODELS ("provider/model") narrows every group.
 */
const enabled = process.env.CONTEXT_ROUTING_TEST === "true";

const MODEL_IDS = ["glm-5.3-flash", "glm-5.3", "deepseek-v4.1-flash"];

// The short window reported for these models in production (Reka AI).
const SHORT_WINDOW = 262_144;

// ~4 chars/token for the generated code; 1.4M chars keeps the real prompt
// well above SHORT_WINDOW and well below a 1M window across tokenizers.
const LONG_PROMPT_CHARS = 1_400_000;

const OUTPUT_TOKENS = 1024;

interface AirsideListing {
	modelId: string;
	providerId: string;
	externalId: string;
	apiFormat: ProviderApiFormat | null;
	inputPrice: string;
	outputPrice: string;
	cachedInputPrice: string;
	contextSize: number;
	maxOutput: number | null;
	vision: boolean;
	reasoning: boolean;
	reasoningEfforts: string[] | null;
	tools: boolean;
	supportedToolChoices: ToolChoiceMode[] | null;
	jsonOutput: boolean;
	jsonOutputSchema: boolean;
}

/**
 * Production Airside listings of the covered models whose carriers have
 * local credentials. Listings of carriers without one (custom carriers) are
 * not reproducible here.
 */
const AIRSIDE_LISTINGS: AirsideListing[] = [];

// Far below every real price, so the short deployment is the cheapest
// candidate and only its window can keep it from being picked.
const CHEAPEST_PRICE = "0.000000001";

/**
 * The short-window deployment per model. No model has a real short deployment
 * with local credentials, so a keyed deployment is listed with Reka AI's 262k
 * window instead.
 */
const ROUTING_CASES: {
	modelId: string;
	shortProviderId: string;
	shortContextSize: number;
}[] = [
	{
		modelId: "glm-5.3-flash",
		shortProviderId: "novita",
		shortContextSize: SHORT_WINDOW,
	},
	{
		modelId: "glm-5.3",
		shortProviderId: "zai",
		shortContextSize: SHORT_WINDOW,
	},
	{
		modelId: "deepseek-v4.1-flash",
		shortProviderId: "deepseek",
		shortContextSize: SHORT_WINDOW,
	},
];

function getModel(modelId: string): ModelDefinition {
	const model = models.find((m) => m.id === modelId) as
		ModelDefinition | undefined;
	if (!model) {
		throw new Error(`Unknown model ${modelId}`);
	}
	return model;
}

function hasCredentials(providerId: string): boolean {
	const def = getProviderDefinition(providerId);
	if (!def) {
		return false;
	}
	return Object.values(def.env.required as Record<string, string | undefined>)
		.filter((name): name is string => Boolean(name))
		.every((name) => Boolean(process.env[name]));
}

function selected(providerId: string, modelId: string): boolean {
	return !specifiedModels || matchesTestModel(providerId, modelId);
}

interface Deployment {
	modelId: string;
	providerId: string;
	/** Pinned for region-scoped providers: the BYOK key reaches its default region only. */
	region?: string;
	contextSize: number;
}

function defaultRegionOf(
	providerId: string,
	mapping: ProviderModelMapping,
): string | undefined {
	const defaultRegion =
		getProviderDefinition(providerId)?.regionConfig?.defaultRegion;
	return defaultRegion &&
		expandAllProviderRegions([mapping]).some((m) => m.region === defaultRegion)
		? defaultRegion
		: undefined;
}

function deploymentsFor(modelId: string): Deployment[] {
	const now = new Date();
	const byProvider = new Map<string, Deployment>();
	for (const mapping of getModel(modelId).providers) {
		if (mapping.deactivatedAt && mapping.deactivatedAt <= now) {
			continue;
		}
		if (mapping.contextSize) {
			byProvider.set(mapping.providerId, {
				modelId,
				providerId: mapping.providerId,
				region: defaultRegionOf(mapping.providerId, mapping),
				contextSize: mapping.contextSize,
			});
		}
	}
	for (const listing of AIRSIDE_LISTINGS) {
		if (listing.modelId === modelId) {
			byProvider.set(listing.providerId, {
				modelId,
				providerId: listing.providerId,
				contextSize: listing.contextSize,
			});
		}
	}
	return [...byProvider.values()].filter(
		(d) => hasCredentials(d.providerId) && selected(d.providerId, modelId),
	);
}

const deployments = MODEL_IDS.flatMap(deploymentsFor).map((d) => ({
	...d,
	model: `${d.providerId}/${d.modelId}${d.region ? `:${d.region}` : ""}`,
}));

const routingCases = ROUTING_CASES.filter(
	(c) =>
		hasCredentials(c.shortProviderId) &&
		(!specifiedModels ||
			getModel(c.modelId).providers.some((p) =>
				matchesTestModel(p.providerId, c.modelId),
			) ||
			matchesTestModel(c.shortProviderId, c.modelId)),
);

/** Varied TypeScript source, so the prompt tokenizes like real code. */
function codeBlock(chars: number, seed: string): string {
	let out = "";
	for (let i = 0; out.length < chars; i++) {
		out += `export function ${seed}_handler_${i}(input: Record<string, number>, limit = ${(i * 7919) % 10007}): number {\n\tconst total = Object.values(input).reduce((sum, value) => sum + value * ${i % 97}, 0);\n\treturn total > limit ? total - limit : limit - total; // ${seed}:${i}\n}\n`;
	}
	return out.slice(0, chars);
}

function seedFrom(requestId: string): string {
	return requestId.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
}

const FINAL_INSTRUCTION = "Do not call any tools. Reply with exactly: OK";

function plainLongPrompt(chars: number, seed: string) {
	return [
		{
			role: "system",
			content: "You are a coding assistant reviewing a large source file.",
		},
		{
			role: "user",
			content: `Here is src/handlers.ts:\n\n${codeBlock(chars, seed)}\n\n${FINAL_INSTRUCTION}`,
		},
	];
}

const AGENT_TOOLS = [
	{
		type: "function",
		function: {
			name: "write_file",
			description: "Write a file to the workspace.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string" },
					content: { type: "string" },
				},
				required: ["path", "content"],
			},
		},
	},
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read a file from the workspace.",
			parameters: {
				type: "object",
				properties: { path: { type: "string" } },
				required: ["path"],
			},
		},
	},
];

/**
 * An OpenCode-style session: most of the context sits in write_file
 * arguments, the rest in read_file results.
 */
function agentSession(chars: number, seed: string) {
	const rounds = 12;
	const perRound = Math.floor(chars / rounds);
	const messages: Record<string, unknown>[] = [
		{
			role: "system",
			content: "You are a coding agent working in a TypeScript repository.",
		},
		{ role: "user", content: "Split the handlers module into parts." },
	];
	for (let r = 0; r < rounds; r++) {
		const written = codeBlock(Math.floor(perRound * 0.75), `${seed}w${r}`);
		messages.push(
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: `call_w${r}`,
						type: "function",
						function: {
							name: "write_file",
							arguments: JSON.stringify({
								path: `src/handlers/part-${r}.ts`,
								content: written,
							}),
						},
					},
				],
			},
			{
				role: "tool",
				tool_call_id: `call_w${r}`,
				content: `Wrote src/handlers/part-${r}.ts (${written.length} bytes)`,
			},
			{
				role: "assistant",
				content: "",
				tool_calls: [
					{
						id: `call_r${r}`,
						type: "function",
						function: {
							name: "read_file",
							arguments: JSON.stringify({
								path: `src/handlers/part-${r}.spec.ts`,
							}),
						},
					},
				],
			},
			{
				role: "tool",
				tool_call_id: `call_r${r}`,
				content: codeBlock(Math.floor(perRound * 0.25), `${seed}r${r}`),
			},
		);
	}
	messages.push({ role: "user", content: FINAL_INSTRUCTION });
	return messages;
}

async function complete(
	body: Record<string, unknown>,
	requestId: string,
	pinned: boolean,
) {
	const res = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"x-request-id": requestId,
			...(pinned ? { "x-no-fallback": "true" } : {}),
			Authorization: "Bearer real-token",
		},
		body: JSON.stringify({ max_tokens: OUTPUT_TOKENS, ...body }),
	});
	const json = await res.json();
	if (logMode || res.status !== 200) {
		console.log(
			`${String(body.model)} → ${res.status}:`,
			JSON.stringify(json).slice(0, 2000),
		);
	}
	return { status: res.status, json };
}

type MappingRow = typeof tables.modelProviderMapping.$inferSelect;

/** Rows replaced by this file, restored in afterAll; null = inserted. */
const touchedMappings = new Map<string, MappingRow | null>();

async function listOnAirside(listing: AirsideListing): Promise<void> {
	await db
		.insert(tables.provider)
		.values({
			id: listing.providerId,
			name: listing.providerId,
			description: "",
		})
		.onConflictDoNothing();
	const model = getModel(listing.modelId);
	await db
		.insert(tables.model)
		.values({
			id: model.id,
			name: model.name ?? model.id,
			family: model.family,
		})
		.onConflictDoNothing();

	const values = {
		externalId: listing.externalId,
		apiFormat: listing.apiFormat,
		source: "airside" as const,
		region: null,
		inputPrice: listing.inputPrice,
		outputPrice: listing.outputPrice,
		cachedInputPrice: listing.cachedInputPrice,
		contextSize: listing.contextSize,
		maxOutput: listing.maxOutput,
		streaming: true,
		vision: listing.vision,
		reasoning: listing.reasoning,
		reasoningEfforts: listing.reasoningEfforts,
		tools: listing.tools,
		supportedToolChoices: listing.supportedToolChoices,
		jsonOutput: listing.jsonOutput,
		jsonOutputSchema: listing.jsonOutputSchema,
		status: "active" as const,
		deactivatedAt: null,
	};
	const existing = await db.query.modelProviderMapping.findFirst({
		where: {
			modelId: { eq: listing.modelId },
			providerId: { eq: listing.providerId },
			region: { isNull: true },
		},
	});
	const key = `${listing.modelId}:${listing.providerId}`;
	if (existing) {
		if (!touchedMappings.has(key)) {
			touchedMappings.set(key, existing);
		}
		await db
			.update(tables.modelProviderMapping)
			.set(values)
			.where(eq(tables.modelProviderMapping.id, existing.id));
	} else {
		if (!touchedMappings.has(key)) {
			touchedMappings.set(key, null);
		}
		await db.insert(tables.modelProviderMapping).values({
			modelId: listing.modelId,
			providerId: listing.providerId,
			...values,
		});
	}
}

async function restoreMappings(): Promise<void> {
	for (const [key, original] of touchedMappings) {
		const [modelId, providerId] = key.split(":");
		const current = await db.query.modelProviderMapping.findFirst({
			where: {
				modelId: { eq: modelId },
				providerId: { eq: providerId },
				region: { isNull: true },
			},
		});
		if (!current) {
			continue;
		}
		if (original) {
			const { id: _id, createdAt: _createdAt, ...rest } = original;
			await db
				.update(tables.modelProviderMapping)
				.set(rest)
				.where(eq(tables.modelProviderMapping.id, current.id));
		} else {
			await db
				.delete(tables.modelProviderMapping)
				.where(eq(tables.modelProviderMapping.id, current.id));
		}
	}
	touchedMappings.clear();
	await clearCache();
}

/** List the short deployment as the cheapest candidate with a short window. */
async function listShortDeployment(
	modelId: string,
	providerId: string,
	contextSize: number,
): Promise<void> {
	const fixture = AIRSIDE_LISTINGS.find(
		(l) => l.modelId === modelId && l.providerId === providerId,
	);
	if (fixture) {
		await listOnAirside({
			...fixture,
			contextSize,
			inputPrice: CHEAPEST_PRICE,
			outputPrice: CHEAPEST_PRICE,
			cachedInputPrice: CHEAPEST_PRICE,
		});
		return;
	}
	const mapping = getModel(modelId).providers.find(
		(p) => p.providerId === providerId,
	);
	if (!mapping) {
		throw new Error(`${providerId} does not serve ${modelId}`);
	}
	await listOnAirside({
		modelId,
		providerId,
		externalId: mapping.externalId,
		apiFormat: mapping.apiFormat ?? null,
		inputPrice: CHEAPEST_PRICE,
		outputPrice: CHEAPEST_PRICE,
		cachedInputPrice: CHEAPEST_PRICE,
		contextSize,
		maxOutput: mapping.maxOutput ?? null,
		vision: mapping.vision ?? false,
		reasoning: mapping.reasoning ?? false,
		reasoningEfforts: mapping.reasoningEfforts
			? [...mapping.reasoningEfforts]
			: null,
		tools: mapping.tools ?? false,
		supportedToolChoices: mapping.supportedToolChoices
			? [...mapping.supportedToolChoices]
			: null,
		jsonOutput: mapping.jsonOutput ?? false,
		jsonOutputSchema: mapping.jsonOutputSchema ?? false,
	});
}

function contextSizeOf(modelId: string, providerId: string): number {
	const deployment = deploymentsFor(modelId).find(
		(d) => d.providerId === providerId,
	);
	if (!deployment) {
		throw new Error(`No deployment ${providerId}/${modelId}`);
	}
	return deployment.contextSize;
}

/** Airside preflight cases: a declared window and whether it really fits. */
const PREFLIGHT_CASES = [
	{ providerId: "novita", modelId: "glm-5.3-flash", passes: true },
].filter(
	({ providerId, modelId }) =>
		hasCredentials(providerId) && selected(providerId, modelId),
);

const PREFLIGHT_DECLARED_WINDOW = 1_048_576;

function apiKeyOf(providerId: string): string {
	const name = (
		getProviderDefinition(providerId)?.env.required as
			{ apiKey?: string } | undefined
	)?.apiKey;
	const value = name ? process.env[name] : undefined;
	if (!value) {
		throw new Error(`No API key for ${providerId}`);
	}
	return value;
}

const describeEnabled = enabled ? describe : describe.skip;

describeEnabled("e2e long-context routing", () => {
	let previousTimeout: string | undefined;

	beforeAll(async () => {
		previousTimeout = process.env.AI_TIMEOUT_MS;
		// Prefilling several hundred thousand tokens can take minutes.
		process.env.AI_TIMEOUT_MS = "600000";
		await beforeAllHook();
		for (const listing of AIRSIDE_LISTINGS) {
			await listOnAirside(listing);
		}
		await clearCache();
	});

	afterAll(async () => {
		await restoreMappings();
		if (previousTimeout === undefined) {
			delete process.env.AI_TIMEOUT_MS;
		} else {
			process.env.AI_TIMEOUT_MS = previousTimeout;
		}
	});

	beforeEach(beforeEachHook);

	test("covers a deployment of every model", () => {
		if (specifiedModels) {
			return;
		}
		for (const modelId of MODEL_IDS) {
			expect(deployments.some((d) => d.modelId === modelId)).toBe(true);
		}
	});

	describe.concurrent("advertised window per deployment", () => {
		test.each(deployments)(
			"$model serves its advertised window ($contextSize)",
			{ timeout: 900_000, retry: 1 },
			async ({ model, providerId, contextSize }) => {
				const chars =
					contextSize >= 2 * SHORT_WINDOW
						? LONG_PROMPT_CHARS
						: Math.floor(contextSize * 0.5 * 4);
				const requestId = generateTestRequestId();
				const { status, json } = await complete(
					{
						model,
						messages: plainLongPrompt(chars, seedFrom(requestId)),
					},
					requestId,
					true,
				);

				const log = await waitForLogByRequestId(requestId);
				expect(status, JSON.stringify(log.errorDetails)).toBe(200);
				expect(log.usedProvider).toBe(providerId);
				expect(log.errorDetails).toBeNull();

				const promptTokens = json.usage?.prompt_tokens;
				expect(typeof promptTokens).toBe("number");
				if (contextSize >= 2 * SHORT_WINDOW) {
					// A 262k deployment would have rejected this prompt.
					expect(promptTokens).toBeGreaterThan(SHORT_WINDOW);
				} else {
					expect(promptTokens).toBeGreaterThan(contextSize * 0.4);
				}
				expect(promptTokens + OUTPUT_TOKENS).toBeLessThanOrEqual(contextSize);
			},
		);
	});

	describe.concurrent("airside preflight context probe", () => {
		test.each(PREFLIGHT_CASES)(
			"$providerId/$modelId preflight at a 1M window (passes: $passes)",
			{ timeout: 900_000 },
			async ({ providerId, modelId, passes }) => {
				const listing = AIRSIDE_LISTINGS.find(
					(l) => l.modelId === modelId && l.providerId === providerId,
				);
				const mapping = getModel(modelId).providers.find(
					(p) => p.providerId === providerId,
				);
				const reported: number[] = [];
				const fetchImplementation: typeof fetch = async (input, init) => {
					const res = await fetch(input, init);
					const body = (await res
						.clone()
						.json()
						.catch(() => null)) as {
						usage?: { prompt_tokens?: number };
					} | null;
					if (typeof body?.usage?.prompt_tokens === "number") {
						reported.push(body.usage.prompt_tokens);
					}
					return res;
				};
				const apiFormat = listing ? listing.apiFormat : mapping?.apiFormat;
				const result = await runProviderModelVerification({
					target: {
						providerId,
						modelName: modelId,
						externalId: listing?.externalId ?? mapping?.externalId ?? modelId,
						apiFormat:
							apiFormat && apiFormat !== "provider-native"
								? apiFormat
								: undefined,
						streaming: false,
						vision: false,
						audio: false,
						tools: false,
						jsonOutput: false,
						jsonOutputSchema: false,
						reasoning: false,
						reasoningMaxTokens: false,
						reasoningEfforts: null,
						webSearch: false,
						contextSize: PREFLIGHT_DECLARED_WINDOW,
						maxOutput: null,
					},
					token: apiKeyOf(providerId),
					fetchImplementation,
				});
				const check = result.checks.find((c) => c.id === "context_size");
				if (logMode || !passes) {
					console.log(`${providerId}/${modelId} preflight:`, check, reported);
				}
				if (passes) {
					expect(check?.status, check?.feedback).toBe("passed");
					expect(Math.max(...reported)).toBeGreaterThanOrEqual(
						PREFLIGHT_DECLARED_WINDOW * 0.8,
					);
					expect(Math.max(...reported)).toBeLessThan(PREFLIGHT_DECLARED_WINDOW);
				} else {
					expect(check?.status).toBe("failed");
				}
			},
		);
	});

	describe.sequential("short-window deployments", () => {
		const shortPrompt = (requestId: string) => [
			{
				role: "user",
				content: `Session ${seedFrom(requestId)}. Reply with exactly: OK`,
			},
		];

		test.each(routingCases)(
			"$modelId skips $shortProviderId ($shortContextSize) unless pinned",
			{ timeout: 900_000, retry: 1 },
			async ({ modelId, shortProviderId, shortContextSize }) => {
				await listShortDeployment(modelId, shortProviderId, shortContextSize);
				try {
					await clearCache();

					// Even a short prompt for the bare id skips the cheapest
					// deployment, because its window is far below the model's.
					const shortRequestId = generateTestRequestId();
					const short = await complete(
						{ model: modelId, messages: shortPrompt(shortRequestId) },
						shortRequestId,
						false,
					);
					const shortLog = await waitForLogByRequestId(shortRequestId);
					expect(shortLog.usedProvider).not.toBe(shortProviderId);
					expect(
						shortLog.routingMetadata?.filteredProviders?.find(
							(f) => f.providerId === shortProviderId,
						)?.codes,
					).toContain("context_size");
					expect(
						short.status,
						`${shortLog.usedProvider}/${modelId}: ${JSON.stringify(shortLog.errorDetails)}`,
					).toBe(200);

					// Pinning still reaches it.
					const pinnedRequestId = generateTestRequestId();
					const pinned = await complete(
						{
							model: `${shortProviderId}/${modelId}`,
							messages: shortPrompt(pinnedRequestId),
						},
						pinnedRequestId,
						true,
					);
					const pinnedLog = await waitForLogByRequestId(pinnedRequestId);
					expect(pinned.status, JSON.stringify(pinnedLog.errorDetails)).toBe(
						200,
					);
					expect(pinnedLog.usedProvider).toBe(shortProviderId);

					const requestId = generateTestRequestId();
					const { status, json } = await complete(
						{
							model: modelId,
							messages: agentSession(LONG_PROMPT_CHARS, seedFrom(requestId)),
							tools: AGENT_TOOLS,
						},
						requestId,
						false,
					);
					// Routing is asserted before the upstream outcome, so a failing
					// 1M deployment is reported as such rather than as a routing bug.
					const log = await waitForLogByRequestId(requestId);
					expect(log.usedProvider).not.toBe(shortProviderId);
					const excluded = log.routingMetadata?.filteredProviders?.find(
						(f) => f.providerId === shortProviderId,
					);
					expect(excluded?.codes).toContain("context_size");

					expect(
						status,
						`${log.usedProvider}/${modelId}: ${JSON.stringify(log.errorDetails)}`,
					).toBe(200);
					expect(log.errorDetails).toBeNull();

					const promptTokens = json.usage?.prompt_tokens;
					expect(typeof promptTokens).toBe("number");
					// The short deployment cannot hold this session; a smaller count means
					// the serving deployment truncated it.
					expect(
						promptTokens + OUTPUT_TOKENS,
						`${log.usedProvider}/${modelId} prompt_tokens`,
					).toBeGreaterThan(shortContextSize);
					expect(
						contextSizeOf(modelId, log.usedProvider),
					).toBeGreaterThanOrEqual(promptTokens + OUTPUT_TOKENS);
				} finally {
					await restoreMappings();
					for (const listing of AIRSIDE_LISTINGS) {
						await listOnAirside(listing);
					}
					await clearCache();
				}
			},
		);
	});
});
