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
 * 2. An unpinned coding-agent session larger than a short-window deployment
 *    is routed past it even when that deployment is the cheapest — and a
 *    short prompt still lands on it, so the exclusion is size-driven.
 *
 * TEST_MODELS ("provider/model") narrows both groups.
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
const AIRSIDE_LISTINGS: AirsideListing[] = [
	{
		modelId: "glm-5.3-flash",
		providerId: "gonka24",
		externalId: "glm-5.3-flash",
		apiFormat: "provider-native",
		inputPrice: "0.00000015",
		outputPrice: "0.0000003",
		cachedInputPrice: "0.000000035",
		contextSize: 200_000,
		maxOutput: 16384,
		vision: false,
		reasoning: true,
		reasoningEfforts: null,
		tools: true,
		supportedToolChoices: null,
		jsonOutput: true,
		jsonOutputSchema: true,
	},
	{
		modelId: "glm-5.3-flash",
		providerId: "consensusprotocol",
		externalId: "glm-5.3-flash",
		apiFormat: null,
		inputPrice: "0.0000001",
		outputPrice: "0.00000025",
		cachedInputPrice: "0.00000002",
		contextSize: 1_048_576,
		maxOutput: null,
		vision: true,
		reasoning: true,
		reasoningEfforts: ["low", "high", "max"],
		tools: true,
		supportedToolChoices: null,
		jsonOutput: false,
		jsonOutputSchema: false,
	},
	{
		modelId: "glm-5.3-flash",
		providerId: "runware",
		externalId: "zai:glm@5.3-flash",
		apiFormat: "provider-native",
		inputPrice: "0.00000015",
		outputPrice: "0.0000005",
		cachedInputPrice: "0.00000003",
		contextSize: 1_000_000,
		maxOutput: 131072,
		vision: true,
		reasoning: true,
		reasoningEfforts: [
			"none",
			"minimal",
			"low",
			"medium",
			"high",
			"xhigh",
			"max",
		],
		tools: true,
		supportedToolChoices: null,
		jsonOutput: true,
		jsonOutputSchema: true,
	},
	{
		modelId: "glm-5.3-flash",
		providerId: "scx-ai-gp",
		externalId: "GLM-5.3-Flash",
		apiFormat: "provider-native",
		inputPrice: "0.000000088",
		outputPrice: "0.00000025",
		cachedInputPrice: "0.000000025",
		contextSize: 1_048_576,
		maxOutput: 131072,
		vision: true,
		reasoning: true,
		reasoningEfforts: ["low", "high", "max"],
		tools: true,
		supportedToolChoices: null,
		jsonOutput: true,
		jsonOutputSchema: false,
	},
	{
		modelId: "glm-5.3",
		providerId: "runware",
		externalId: "zai:glm@5.3",
		apiFormat: "provider-native",
		inputPrice: "0.0000012",
		outputPrice: "0.000004",
		cachedInputPrice: "0.0000002",
		contextSize: 1_000_000,
		maxOutput: 131072,
		vision: false,
		reasoning: true,
		reasoningEfforts: ["low", "high", "max"],
		tools: true,
		supportedToolChoices: null,
		jsonOutput: true,
		jsonOutputSchema: true,
	},
	{
		modelId: "glm-5.3",
		providerId: "scx-ai-gp",
		externalId: "GLM-5.3",
		apiFormat: "provider-native",
		inputPrice: "0.000000924",
		outputPrice: "0.000002904",
		cachedInputPrice: "0.0000001716",
		contextSize: 1_000_000,
		maxOutput: 128000,
		vision: false,
		reasoning: true,
		reasoningEfforts: ["low", "high", "max"],
		tools: true,
		supportedToolChoices: null,
		jsonOutput: true,
		jsonOutputSchema: false,
	},
	{
		modelId: "deepseek-v4.1-flash",
		providerId: "scx-ai-gp",
		externalId: "DeepSeek-V4.1-flash",
		apiFormat: "provider-native",
		inputPrice: "0.00000015",
		outputPrice: "0.0000006",
		cachedInputPrice: "0.00000001",
		contextSize: 1_000_000,
		maxOutput: null,
		vision: false,
		reasoning: false,
		reasoningEfforts: null,
		tools: false,
		supportedToolChoices: null,
		jsonOutput: false,
		jsonOutputSchema: false,
	},
	{
		modelId: "deepseek-v4.1-flash",
		providerId: "runware",
		externalId: "deepseek:v4.1@flash",
		apiFormat: "openai-chat-completions",
		inputPrice: "0.00000015",
		outputPrice: "0.0000006",
		cachedInputPrice: "0.00000001",
		contextSize: 1_048_576,
		maxOutput: null,
		vision: true,
		reasoning: true,
		reasoningEfforts: ["low", "high", "xhigh", "max", "none"],
		tools: true,
		supportedToolChoices: ["auto"],
		jsonOutput: true,
		jsonOutputSchema: true,
	},
	{
		modelId: "deepseek-v4.1-flash",
		providerId: "consensusprotocol",
		externalId: "dsv41",
		apiFormat: "provider-native",
		inputPrice: "0.00000015",
		outputPrice: "0.00000055",
		cachedInputPrice: "0.000000005",
		contextSize: 1_048_576,
		maxOutput: null,
		vision: true,
		reasoning: true,
		reasoningEfforts: ["low", "high", "max", "xhigh"],
		tools: true,
		supportedToolChoices: null,
		jsonOutput: false,
		jsonOutputSchema: false,
	},
];

// Far below every real price, so the short deployment is the cheapest
// candidate and only its window can keep it from being picked.
const CHEAPEST_PRICE = "0.000000001";

/**
 * The short-window deployment per model. glm-5.3-flash uses the real 200k
 * Gonka24 deployment; the others have none with local credentials, so a
 * keyed deployment is listed with Reka AI's 262k window instead.
 */
const ROUTING_CASES: {
	modelId: string;
	shortProviderId: string;
	shortContextSize: number;
}[] = [
	{
		modelId: "glm-5.3-flash",
		shortProviderId: "gonka24",
		shortContextSize: 200_000,
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
 * arguments, the rest in read_file results. The tool-call share is what a
 * content-only estimate misses.
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

	describe.sequential("short-window deployments", () => {
		test.each(routingCases)(
			"$modelId routes past $shortProviderId ($shortContextSize) for a long agent session",
			{ timeout: 900_000, retry: 1 },
			async ({ modelId, shortProviderId, shortContextSize }) => {
				await listShortDeployment(modelId, shortProviderId, shortContextSize);
				try {
					await clearCache();

					// Control: a short prompt goes to the short deployment, so the
					// long request below is steered by its size alone.
					const shortRequestId = generateTestRequestId();
					const short = await complete(
						{
							model: modelId,
							messages: [
								{
									role: "user",
									content: `Session ${seedFrom(shortRequestId)}. Reply with exactly: OK`,
								},
							],
						},
						shortRequestId,
						false,
					);
					expect(short.status).toBe(200);
					const shortLog = await waitForLogByRequestId(shortRequestId);
					expect(shortLog.usedProvider).toBe(shortProviderId);

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
					// The short deployment cannot hold this session.
					expect(promptTokens + OUTPUT_TOKENS).toBeGreaterThan(
						shortContextSize,
					);
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
