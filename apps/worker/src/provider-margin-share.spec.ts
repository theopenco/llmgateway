import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, test } from "vitest";

import {
	apiKey,
	db,
	eq,
	isNull,
	log,
	organization,
	project,
	tables,
	user,
} from "@llmgateway/db";

import { batchProcessLogs, flushMarginShareTransactions } from "./worker.js";

describe("provider margin share", () => {
	interface TestIds {
		apiKeyId: string;
		email: string;
		orgId: string;
		projectId: string;
		userId: string;
		endCustomerId: string;
		walletId: string;
	}

	let ids: TestIds | null = null;

	const cleanup = async (testIds: TestIds | null) => {
		if (!testIds) {
			return;
		}
		await db.delete(log).where(eq(log.organizationId, testIds.orgId));
		await db
			.delete(tables.transaction)
			.where(eq(tables.transaction.organizationId, testIds.orgId));
		await db
			.delete(tables.organizationProviderMarginShare)
			.where(
				eq(
					tables.organizationProviderMarginShare.organizationId,
					testIds.orgId,
				),
			);
		await db.delete(apiKey).where(eq(apiKey.id, testIds.apiKeyId));
		await db.delete(project).where(eq(project.id, testIds.projectId));
		await db.delete(organization).where(eq(organization.id, testIds.orgId));
		await db.delete(user).where(eq(user.email, testIds.email));
		await db
			.delete(tables.lock)
			.where(eq(tables.lock.key, "credit_processing"));
		await db
			.delete(tables.lock)
			.where(eq(tables.lock.key, "margin_share_flush"));
	};

	beforeEach(async () => {
		await cleanup(ids);
		// batchProcessLogs pulls the oldest unprocessed logs globally; stray rows
		// from another suite would starve this test's own logs out of the batch.
		await db.delete(log).where(isNull(log.processedAt));

		const suffix = randomUUID();
		ids = {
			apiKeyId: `margin-share-key-${suffix}`,
			email: `margin-share-${suffix}@example.com`,
			orgId: `margin-share-org-${suffix}`,
			projectId: `margin-share-project-${suffix}`,
			userId: `margin-share-user-${suffix}`,
			endCustomerId: `margin-share-customer-${suffix}`,
			walletId: `margin-share-wallet-${suffix}`,
		};

		await db.insert(user).values({
			id: ids.userId,
			email: ids.email,
			name: "Margin Share User",
		});
		await db.insert(organization).values({
			id: ids.orgId,
			name: "Margin Share Org",
			billingEmail: ids.email,
			credits: "100",
		});
		await db.insert(project).values({
			id: ids.projectId,
			organizationId: ids.orgId,
			name: "Margin Share Project",
			mode: "credits",
		});
		await db.insert(apiKey).values({
			id: ids.apiKeyId,
			projectId: ids.projectId,
			tokenHash: `margin-share-token-${suffix}`,
			tokenMasked: `margin-share-token-${suffix}`,
			description: "Margin Share Key",
			usage: "0",
			createdBy: ids.userId,
		});
		await db.insert(tables.endCustomer).values({
			id: ids.endCustomerId,
			organizationId: ids.orgId,
			projectId: ids.projectId,
			externalId: `ext-${suffix}`,
			mode: "live",
		});
		await db.insert(tables.wallet).values({
			id: ids.walletId,
			endCustomerId: ids.endCustomerId,
			projectId: ids.projectId,
			organizationId: ids.orgId,
			mode: "live",
			balance: "10",
		});
	});

	afterAll(async () => {
		await cleanup(ids);
	});

	const setShare = async (sharePercent: string) => {
		await db.insert(tables.organizationProviderMarginShare).values({
			organizationId: ids!.orgId,
			sharePercent,
		});
	};

	const insertLog = async (values: {
		cost: number;
		providerMarginPercent?: number | null;
		usedMode?: "credits" | "api-keys";
		cached?: boolean;
		walletId?: string;
	}) => {
		await db.insert(log).values({
			requestId: `margin-share-request-${randomUUID()}`,
			organizationId: ids!.orgId,
			projectId: ids!.projectId,
			apiKeyId: ids!.apiKeyId,
			endCustomerWalletId: values.walletId ?? null,
			endCustomerId: values.walletId ? ids!.endCustomerId : null,
			cost: values.cost,
			cached: values.cached ?? false,
			usedMode: values.usedMode ?? "credits",
			providerMarginPercent: values.providerMarginPercent ?? null,
			duration: 100,
			requestedModel: "mistral/mistral-medium-4",
			requestedProvider: "mistral",
			usedModel: "mistral-medium-4",
			usedProvider: "mistral",
			responseSize: 100,
			mode: "credits",
		});
	};

	const readState = async () => {
		const org = await db.query.organization.findFirst({
			where: { id: { eq: ids!.orgId } },
		});
		const share = await db.query.organizationProviderMarginShare.findFirst({
			where: { organizationId: { eq: ids!.orgId } },
		});
		const wallet = await db.query.wallet.findFirst({
			where: { id: { eq: ids!.walletId } },
		});
		return {
			credits: Number(org!.credits),
			marginBalance: Number(org!.endUserMarginBalance),
			totalAccrued: Number(share?.totalAccrued ?? "0"),
			pending: Number(share?.pendingTransactionAmount ?? "0"),
			walletBalance: Number(wallet!.balance),
		};
	};

	test("accrues the configured share of carrier margin on org-credit and wallet traffic", async () => {
		await setShare("0.5");
		// org credits: cost 1.0 × margin 0.2 × share 0.5 = 0.1
		await insertLog({ cost: 1, providerMarginPercent: 0.2 });
		// wallet: cost 2.0 × margin 0.3 × share 0.5 = 0.3
		await insertLog({
			cost: 2,
			providerMarginPercent: 0.3,
			walletId: ids!.walletId,
		});

		await batchProcessLogs();

		const state = await readState();
		expect(state.credits).toBeCloseTo(99, 6);
		expect(state.walletBalance).toBeCloseTo(8, 6);
		expect(state.marginBalance).toBeCloseTo(0.4, 6);
		expect(state.totalAccrued).toBeCloseTo(0.4, 6);
		expect(state.pending).toBeCloseTo(0.4, 6);

		// Already-processed logs must not accrue again.
		await batchProcessLogs();
		expect((await readState()).marginBalance).toBeCloseTo(0.4, 6);
	});

	test("ignores BYOK, cached, and unsnapshotted traffic", async () => {
		await setShare("0.5");
		await insertLog({
			cost: 1,
			providerMarginPercent: 0.2,
			usedMode: "api-keys",
		});
		await insertLog({ cost: 1, providerMarginPercent: 0.2, cached: true });
		await insertLog({ cost: 1, providerMarginPercent: null });

		await batchProcessLogs();

		const state = await readState();
		expect(state.marginBalance).toBe(0);
		expect(state.totalAccrued).toBe(0);
	});

	test("accrues nothing without a share row or with a zero share", async () => {
		await insertLog({ cost: 1, providerMarginPercent: 0.2 });
		await batchProcessLogs();
		expect((await readState()).marginBalance).toBe(0);

		await setShare("0");
		await insertLog({ cost: 1, providerMarginPercent: 0.2 });
		await batchProcessLogs();
		const state = await readState();
		expect(state.marginBalance).toBe(0);
		expect(state.credits).toBeCloseTo(98, 6);
	});

	test("flushes pending accrual into one provider_margin_share transaction", async () => {
		await setShare("0.5");
		await insertLog({ cost: 1, providerMarginPercent: 0.2 });
		await insertLog({ cost: 3, providerMarginPercent: 0.2 });
		await batchProcessLogs();

		await flushMarginShareTransactions();

		const transactions = await db.query.transaction.findMany({
			where: {
				organizationId: { eq: ids!.orgId },
				type: { eq: "provider_margin_share" },
			},
		});
		expect(transactions).toHaveLength(1);
		expect(Number(transactions[0].amount)).toBeCloseTo(0.4, 6);
		expect(Number(transactions[0].creditAmount)).toBeCloseTo(0.4, 6);
		expect(transactions[0].status).toBe("completed");

		const state = await readState();
		expect(state.pending).toBe(0);
		expect(state.totalAccrued).toBeCloseTo(0.4, 6);
		expect(state.marginBalance).toBeCloseTo(0.4, 6);

		// Nothing pending → no second row.
		await flushMarginShareTransactions();
		expect(
			await db.query.transaction.findMany({
				where: {
					organizationId: { eq: ids!.orgId },
					type: { eq: "provider_margin_share" },
				},
			}),
		).toHaveLength(1);
	});
});
