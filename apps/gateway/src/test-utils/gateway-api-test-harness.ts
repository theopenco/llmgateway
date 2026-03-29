import { afterAll, afterEach, beforeAll, beforeEach, expect } from "vitest";

import { and, db, eq, pool, tables } from "@llmgateway/db";
import { getProviderDefinition, models } from "@llmgateway/models";
import { verifyVideoContentAccessToken } from "@llmgateway/shared/video-access";

import {
	resetMockVideoState,
	startMockServer,
	stopMockServer,
} from "./mock-openai-server.js";
import { clearCache } from "./test-helpers.js";

type ProjectMode = "api-keys" | "credits" | "hybrid";
interface GatewayApiTestHarnessOptions {
	mockServerPort: number;
}
interface LockClient {
	query: (text: string, values?: unknown[]) => Promise<unknown>;
	release: () => void;
}

const TEST_USER_ID = "user-id";
const TEST_ORGANIZATION_ID = "org-id";
const TEST_PROJECT_ID = "project-id";
const GATEWAY_TEST_DB_LOCK_ID = 41001;

async function resetGatewayTestData() {
	await db.delete(tables.log);
	await db.delete(tables.webhookDeliveryLog);
	await db.delete(tables.videoJob);
	await db.delete(tables.apiKey);
	await db.delete(tables.providerKey);
	await db.delete(tables.userOrganization);
	await db.delete(tables.project);
	await db.delete(tables.organization);
	await db.delete(tables.user);
	await db.delete(tables.account);
	await db.delete(tables.session);
	await db.delete(tables.verification);
}

async function seedGatewayTestData() {
	await db.insert(tables.user).values({
		id: TEST_USER_ID,
		name: "user",
		email: "user",
	});

	await db.insert(tables.organization).values({
		id: TEST_ORGANIZATION_ID,
		name: "Test Organization",
		billingEmail: "user",
		plan: "pro",
		retentionLevel: "retain",
		credits: "100.00",
	});

	await db.insert(tables.userOrganization).values({
		id: "user-org-id",
		userId: TEST_USER_ID,
		organizationId: TEST_ORGANIZATION_ID,
	});

	await db.insert(tables.project).values({
		id: TEST_PROJECT_ID,
		name: "Test Project",
		organizationId: TEST_ORGANIZATION_ID,
		mode: "api-keys",
	});
}

async function ensureRoutingMetricMapping(modelId: string, providerId: string) {
	const modelDefinition = models.find((model) => model.id === modelId);
	const providerMapping = modelDefinition?.providers.find(
		(mapping) => mapping.providerId === providerId,
	);

	if (!modelDefinition || !providerMapping) {
		return;
	}

	const providerDefinition = getProviderDefinition(providerId);

	await db
		.insert(tables.provider)
		.values({
			id: providerId,
			name: providerDefinition?.name ?? providerId,
			description:
				providerDefinition?.description ?? `Test provider ${providerId}`,
			streaming: providerDefinition?.streaming ?? null,
			cancellation: providerDefinition?.cancellation ?? null,
			color: providerDefinition?.color ?? null,
			website: providerDefinition?.website ?? null,
			announcement: providerDefinition?.announcement ?? null,
			status: "active",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.model)
		.values({
			id: modelId,
			name: modelDefinition.name,
			description: modelDefinition.description,
			family: modelDefinition.family,
			status: "active",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.modelProviderMapping)
		.values({
			id: `${modelId}::${providerId}`,
			modelId,
			providerId,
			modelName: providerMapping.modelName,
			status: "active",
		})
		.onConflictDoNothing();
}

export function createGatewayApiTestHarness(
	options: GatewayApiTestHarnessOptions,
) {
	let mockServerUrl = "";
	let lockClient: LockClient | null = null;

	beforeAll(() => {
		mockServerUrl = startMockServer(options.mockServerPort);
	});

	afterAll(() => {
		stopMockServer();
	});

	beforeEach(async () => {
		lockClient = await pool.connect();
		await lockClient.query("SELECT pg_advisory_lock($1)", [
			GATEWAY_TEST_DB_LOCK_ID,
		]);
		await clearCache();
		resetMockVideoState();
		await resetGatewayTestData();
		await seedGatewayTestData();
	});

	afterEach(async () => {
		const client = lockClient;
		if (!client) {
			return;
		}

		try {
			await client.query("SELECT pg_advisory_unlock($1)", [
				GATEWAY_TEST_DB_LOCK_ID,
			]);
		} finally {
			client.release();
			lockClient = null;
		}
	});

	return {
		get mockServerUrl() {
			return mockServerUrl;
		},
		async setProjectMode(mode: ProjectMode) {
			await db
				.update(tables.project)
				.set({ mode })
				.where(eq(tables.project.id, TEST_PROJECT_ID));
		},
		async setOrganizationCredits(credits: string) {
			await db
				.update(tables.organization)
				.set({ credits })
				.where(eq(tables.organization.id, TEST_ORGANIZATION_ID));
		},
		async setRoutingMetrics(
			modelId: string,
			providerId: string,
			metrics: {
				uptime: number;
				latency?: number;
				throughput?: number;
				totalRequests?: number;
			},
		) {
			await ensureRoutingMetricMapping(modelId, providerId);

			await db
				.update(tables.modelProviderMapping)
				.set({
					status: "active",
					routingUptime: metrics.uptime,
					routingLatency: metrics.latency ?? 100,
					routingThroughput: metrics.throughput ?? 100,
					routingTotalRequests: metrics.totalRequests ?? 100,
				})
				.where(
					and(
						eq(tables.modelProviderMapping.modelId, modelId),
						eq(tables.modelProviderMapping.providerId, providerId),
					),
				);
		},
		expectSignedVideoLogContentUrl(url: string, logId: string) {
			const validAfterSixDays = 6 * 24 * 60 * 60 * 1000;
			const expiredAfterEightDays = 8 * 24 * 60 * 60 * 1000;
			const parsed = new URL(url);
			expect(parsed.origin).toBe("http://localhost:4001");
			expect(parsed.pathname).toBe(`/v1/videos/logs/${logId}/content`);
			const token = parsed.searchParams.get("token");
			expect(token).toBeTruthy();
			if (!token) {
				throw new Error("Missing video access token");
			}

			expect(verifyVideoContentAccessToken(token, logId)).toBe(true);
			expect(
				verifyVideoContentAccessToken(
					token,
					logId,
					new Date(Date.now() + validAfterSixDays),
				),
			).toBe(true);
			expect(
				verifyVideoContentAccessToken(
					token,
					logId,
					new Date(Date.now() + expiredAfterEightDays),
				),
			).toBe(false);

			return parsed;
		},
	};
}
