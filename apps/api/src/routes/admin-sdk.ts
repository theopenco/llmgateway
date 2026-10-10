import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import {
	and,
	db,
	desc,
	eq,
	gte,
	inArray,
	ne,
	or,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Admin overview of the LLM SDK (embeddable end-user wallets) economy: what
 * end-users paid, what LLM Gateway kept as platform fee, what developers accrued
 * as markup margin, what developers funded as top-up bonus, and what is still
 * outstanding as wallet balance or unpaid margin — in total and per developer
 * organization. Read-only.
 */

export const adminSdk = new OpenAPIHono<ServerTypes>();

adminSdk.use("/*", adminMiddleware);

const ledger = tables.walletLedger;
const walletTable = tables.wallet;

// `reversal` ledger rows carry no economic split, so a refunded top-up has to be
// identified by its PaymentIntent and the split read off the original `topup`
// row. Both types are unique per PaymentIntent (partial unique indexes), so this
// stays 1:1.
const isRefunded = sql`${ledger.stripePaymentIntentId} IN (SELECT r.stripe_payment_intent_id FROM wallet_ledger r WHERE r.type = 'reversal' AND r.stripe_payment_intent_id IS NOT NULL)`;

const modeFilterSchema = z.enum(["all", "live", "test"]);

const sortBySchema = z.enum([
	"grossPaid",
	"platformFee",
	"developerMargin",
	"bonusFunded",
	"usageSpent",
	"walletBalance",
	"marginOwed",
	"topUps",
	"wallets",
]);

const sdkTotalsSchema = z.object({
	/** What end-users paid Stripe, including the platform fee. */
	grossPaid: z.number(),
	/** Subset of `grossPaid` that was later refunded. */
	grossPaidRefunded: z.number(),
	/** LLM Gateway's 5% cut on top of the top-up amount. */
	platformFee: z.number(),
	platformFeeRefunded: z.number(),
	/** Developer markup accrued as a payable liability. */
	developerMargin: z.number(),
	developerMarginRefunded: z.number(),
	/** Real spend power credited into wallets. */
	netCredited: z.number(),
	netCreditedRefunded: z.number(),
	/** Bonus spend power credited into wallets. */
	bonusCredited: z.number(),
	/** Spend power granted server-side by the developer, free of any payment. */
	adjustmentsCredited: z.number(),
	/** Bonus the developer org actually paid for out of its own credits. */
	bonusFunded: z.number(),
	/** Wallet balance drained by gateway usage. */
	usageSpent: z.number(),
	/** Wallet balance still outstanding (a liability). */
	walletBalance: z.number(),
	/** Accrued margin not yet paid out to the developer. */
	marginOwed: z.number(),
	/** Margin already transferred out via Stripe Connect. */
	marginPaidOut: z.number(),
	topUps: z.number(),
	refunds: z.number(),
	wallets: z.number(),
	liveWallets: z.number(),
	testWallets: z.number(),
	endCustomers: z.number(),
	sdkProjects: z.number(),
});

type SdkTotals = z.infer<typeof sdkTotalsSchema>;

const TOTALS_KEYS = Object.keys(sdkTotalsSchema.shape) as (keyof SdkTotals)[];

const sdkOrganizationSchema = sdkTotalsSchema.extend({
	organizationId: z.string(),
	organizationName: z.string(),
	billingEmail: z.string().nullable(),
	plan: z.string(),
	kind: z.string(),
	credits: z.number(),
	stripeConnectOnboarded: z.boolean(),
	/** Highest markup / bonus configured across the org's SDK projects. */
	maxMarkupPercent: z.number(),
	maxBonusPercent: z.number(),
	lastTopUpAt: z.string().nullable(),
});

const sdkRecentTopUpSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	organizationId: z.string(),
	organizationName: z.string(),
	endCustomerId: z.string(),
	endCustomerExternalId: z.string(),
	mode: z.string(),
	grossPaid: z.number(),
	platformFee: z.number(),
	developerMargin: z.number(),
	netCredited: z.number(),
	refunded: z.boolean(),
	stripePaymentIntentId: z.string().nullable(),
});

const getSdkOverview = createRoute({
	method: "get",
	path: "/sdk",
	request: {
		query: z.object({
			days: z.coerce.number().int().min(1).max(3650).optional(),
			mode: modeFilterSchema.optional(),
			sortBy: sortBySchema.optional(),
			limit: z.coerce.number().int().min(1).max(200).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						totals: sdkTotalsSchema,
						organizations: z.array(sdkOrganizationSchema),
						recentTopUps: z.array(sdkRecentTopUpSchema),
						days: z.number().nullable(),
						mode: modeFilterSchema,
					}),
				},
			},
			description:
				"LLM SDK end-user wallet economics, in total and per developer organization.",
		},
	},
});

function emptyTotals(): SdkTotals {
	return {
		grossPaid: 0,
		grossPaidRefunded: 0,
		platformFee: 0,
		platformFeeRefunded: 0,
		developerMargin: 0,
		developerMarginRefunded: 0,
		netCredited: 0,
		netCreditedRefunded: 0,
		bonusCredited: 0,
		adjustmentsCredited: 0,
		bonusFunded: 0,
		usageSpent: 0,
		walletBalance: 0,
		marginOwed: 0,
		marginPaidOut: 0,
		topUps: 0,
		refunds: 0,
		wallets: 0,
		liveWallets: 0,
		testWallets: 0,
		endCustomers: 0,
		sdkProjects: 0,
	};
}

function num(value: unknown): number {
	const parsed = Number(value ?? 0);
	return Number.isFinite(parsed) ? parsed : 0;
}

function toIso(value: Date | string | null): string | null {
	if (!value) {
		return null;
	}
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

adminSdk.openapi(getSdkOverview, async (c) => {
	const query = c.req.valid("query");
	const days = query.days ?? null;
	const mode = query.mode ?? "all";
	const sortBy = query.sortBy ?? "grossPaid";
	const limit = query.limit ?? 100;

	const windowMs = days === null ? null : days * 86_400_000;
	const since = windowMs === null ? null : new Date(Date.now() - windowMs);
	const modeCondition = mode === "all" ? undefined : eq(walletTable.mode, mode);

	const topUpRows = await db
		.select({
			organizationId: ledger.organizationId,
			grossPaid: sql<string>`COALESCE(SUM(CAST(${ledger.grossPaid} AS NUMERIC)), 0)`,
			grossPaidRefunded: sql<string>`COALESCE(SUM(CAST(${ledger.grossPaid} AS NUMERIC)) FILTER (WHERE ${isRefunded}), 0)`,
			platformFee: sql<string>`COALESCE(SUM(CAST(${ledger.platformFee} AS NUMERIC)), 0)`,
			platformFeeRefunded: sql<string>`COALESCE(SUM(CAST(${ledger.platformFee} AS NUMERIC)) FILTER (WHERE ${isRefunded}), 0)`,
			developerMargin: sql<string>`COALESCE(SUM(CAST(${ledger.developerMargin} AS NUMERIC)), 0)`,
			developerMarginRefunded: sql<string>`COALESCE(SUM(CAST(${ledger.developerMargin} AS NUMERIC)) FILTER (WHERE ${isRefunded}), 0)`,
			netCredited: sql<string>`COALESCE(SUM(CAST(${ledger.netCredited} AS NUMERIC)), 0)`,
			netCreditedRefunded: sql<string>`COALESCE(SUM(CAST(${ledger.netCredited} AS NUMERIC)) FILTER (WHERE ${isRefunded}), 0)`,
			topUps: sql<number>`COUNT(*)::int`,
			refunds: sql<number>`(COUNT(*) FILTER (WHERE ${isRefunded}))::int`,
			lastTopUpAt: sql<Date | null>`MAX(${ledger.createdAt})`,
		})
		.from(ledger)
		.innerJoin(walletTable, eq(walletTable.id, ledger.walletId))
		.where(
			and(
				eq(ledger.type, "topup"),
				since ? gte(ledger.createdAt, since) : undefined,
				modeCondition,
			),
		)
		.groupBy(ledger.organizationId);

	// Bonus credited into wallets and wallet balance drained by gateway usage.
	const flowRows = await db
		.select({
			organizationId: ledger.organizationId,
			bonusCredited: sql<string>`COALESCE(SUM(CAST(${ledger.amount} AS NUMERIC)) FILTER (WHERE ${ledger.type} = 'bonus'), 0)`,
			adjustmentsCredited: sql<string>`COALESCE(SUM(CAST(${ledger.amount} AS NUMERIC)) FILTER (WHERE ${ledger.type} = 'adjustment'), 0)`,
			usageSpent: sql<string>`COALESCE(-SUM(CAST(${ledger.amount} AS NUMERIC)) FILTER (WHERE ${ledger.type} = 'usage_debit'), 0)`,
		})
		.from(ledger)
		.innerJoin(walletTable, eq(walletTable.id, ledger.walletId))
		.where(and(since ? gte(ledger.createdAt, since) : undefined, modeCondition))
		.groupBy(ledger.organizationId);

	// Wallet state is point-in-time, so it is never windowed.
	const walletRows = await db
		.select({
			organizationId: walletTable.organizationId,
			walletBalance: sql<string>`COALESCE(SUM(CAST(${walletTable.balance} AS NUMERIC)), 0)`,
			wallets: sql<number>`COUNT(*)::int`,
			liveWallets: sql<number>`(COUNT(*) FILTER (WHERE ${walletTable.mode} = 'live'))::int`,
			testWallets: sql<number>`(COUNT(*) FILTER (WHERE ${walletTable.mode} = 'test'))::int`,
		})
		.from(walletTable)
		.where(modeCondition)
		.groupBy(walletTable.organizationId);

	const endCustomerRows = await db
		.select({
			organizationId: tables.endCustomer.organizationId,
			endCustomers: sql<number>`COUNT(*)::int`,
		})
		.from(tables.endCustomer)
		.where(mode === "all" ? undefined : eq(tables.endCustomer.mode, mode))
		.groupBy(tables.endCustomer.organizationId);

	// Developer-funded bonus and margin payouts live on the org transaction
	// ledger, not the wallet ledger. `end_user_bonus` carries a negative
	// creditAmount when the org funds a bonus and a positive one when a refund
	// claws it back, so the net funded amount is the negated sum.
	const transactionRows = await db
		.select({
			organizationId: tables.transaction.organizationId,
			bonusFunded: sql<string>`COALESCE(-SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)) FILTER (WHERE ${tables.transaction.type} = 'end_user_bonus'), 0)`,
			marginPaidOut: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)) FILTER (WHERE ${tables.transaction.type} = 'end_user_margin_payout'), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				inArray(tables.transaction.type, [
					"end_user_bonus",
					"end_user_margin_payout",
				]),
				eq(tables.transaction.status, "completed"),
				since ? gte(tables.transaction.createdAt, since) : undefined,
			),
		)
		.groupBy(tables.transaction.organizationId);

	// Projects allowed to mint end-user sessions, and the markup/bonus they are
	// configured with.
	const projectRows = await db
		.select({
			organizationId: tables.project.organizationId,
			sdkProjects: sql<number>`COUNT(*)::int`,
			maxMarkupPercent: sql<string>`COALESCE(MAX(CAST(${tables.project.endUserMarkupPercent} AS NUMERIC)), 0)`,
			maxBonusPercent: sql<string>`COALESCE(MAX(CAST(${tables.project.endUserTopUpBonusPercent} AS NUMERIC)), 0)`,
		})
		.from(tables.project)
		.where(
			and(
				or(
					eq(tables.project.endUserEnabled, true),
					eq(tables.project.paymentsSdkEnabled, true),
				),
				ne(tables.project.status, "deleted"),
			),
		)
		.groupBy(tables.project.organizationId);

	const byOrg = new Map<string, SdkTotals & { lastTopUpAt: string | null }>();
	const ensure = (organizationId: string) => {
		let entry = byOrg.get(organizationId);
		if (!entry) {
			entry = { ...emptyTotals(), lastTopUpAt: null };
			byOrg.set(organizationId, entry);
		}
		return entry;
	};

	for (const row of topUpRows) {
		const entry = ensure(row.organizationId);
		entry.grossPaid = num(row.grossPaid);
		entry.grossPaidRefunded = num(row.grossPaidRefunded);
		entry.platformFee = num(row.platformFee);
		entry.platformFeeRefunded = num(row.platformFeeRefunded);
		entry.developerMargin = num(row.developerMargin);
		entry.developerMarginRefunded = num(row.developerMarginRefunded);
		entry.netCredited = num(row.netCredited);
		entry.netCreditedRefunded = num(row.netCreditedRefunded);
		entry.topUps = num(row.topUps);
		entry.refunds = num(row.refunds);
		entry.lastTopUpAt = toIso(row.lastTopUpAt);
	}
	for (const row of flowRows) {
		const entry = ensure(row.organizationId);
		entry.bonusCredited = num(row.bonusCredited);
		entry.adjustmentsCredited = num(row.adjustmentsCredited);
		entry.usageSpent = num(row.usageSpent);
	}
	for (const row of walletRows) {
		const entry = ensure(row.organizationId);
		entry.walletBalance = num(row.walletBalance);
		entry.wallets = num(row.wallets);
		entry.liveWallets = num(row.liveWallets);
		entry.testWallets = num(row.testWallets);
	}
	for (const row of endCustomerRows) {
		ensure(row.organizationId).endCustomers = num(row.endCustomers);
	}
	for (const row of transactionRows) {
		const entry = ensure(row.organizationId);
		entry.bonusFunded = num(row.bonusFunded);
		entry.marginPaidOut = num(row.marginPaidOut);
	}
	for (const row of projectRows) {
		ensure(row.organizationId).sdkProjects = num(row.sdkProjects);
	}

	const organizationIds = [...byOrg.keys()];
	const orgRows = organizationIds.length
		? await db
				.select({
					id: tables.organization.id,
					name: tables.organization.name,
					billingEmail: tables.organization.billingEmail,
					plan: tables.organization.plan,
					kind: tables.organization.kind,
					credits: tables.organization.credits,
					endUserMarginBalance: tables.organization.endUserMarginBalance,
					stripeConnectOnboarded: tables.organization.stripeConnectOnboarded,
				})
				.from(tables.organization)
				.where(inArray(tables.organization.id, organizationIds))
		: [];

	const projectConfig = new Map(
		projectRows.map((row) => [
			row.organizationId,
			{
				maxMarkupPercent: num(row.maxMarkupPercent),
				maxBonusPercent: num(row.maxBonusPercent),
			},
		]),
	);

	const organizations = orgRows.map((org) => {
		const entry = ensure(org.id);
		const config = projectConfig.get(org.id);
		// Margin owed is the org's live accrued balance, never a windowed figure.
		entry.marginOwed = num(org.endUserMarginBalance);
		return {
			...entry,
			organizationId: org.id,
			organizationName: org.name,
			billingEmail: org.billingEmail,
			plan: org.plan,
			kind: org.kind,
			credits: num(org.credits),
			stripeConnectOnboarded: org.stripeConnectOnboarded,
			maxMarkupPercent: config?.maxMarkupPercent ?? 0,
			maxBonusPercent: config?.maxBonusPercent ?? 0,
		};
	});

	const totals = emptyTotals();
	for (const org of organizations) {
		for (const key of TOTALS_KEYS) {
			totals[key] += org[key];
		}
	}

	organizations.sort(
		(a, b) =>
			b[sortBy] - a[sortBy] ||
			a.organizationName.localeCompare(b.organizationName),
	);

	const recentRows = await db
		.select({
			id: ledger.id,
			createdAt: ledger.createdAt,
			organizationId: ledger.organizationId,
			organizationName: tables.organization.name,
			endCustomerId: ledger.endCustomerId,
			endCustomerExternalId: tables.endCustomer.externalId,
			mode: walletTable.mode,
			grossPaid: ledger.grossPaid,
			platformFee: ledger.platformFee,
			developerMargin: ledger.developerMargin,
			netCredited: ledger.netCredited,
			refunded: sql<boolean>`${isRefunded}`,
			stripePaymentIntentId: ledger.stripePaymentIntentId,
		})
		.from(ledger)
		.innerJoin(walletTable, eq(walletTable.id, ledger.walletId))
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, ledger.organizationId),
		)
		.innerJoin(
			tables.endCustomer,
			eq(tables.endCustomer.id, ledger.endCustomerId),
		)
		.where(
			and(
				eq(ledger.type, "topup"),
				since ? gte(ledger.createdAt, since) : undefined,
				modeCondition,
			),
		)
		.orderBy(desc(ledger.createdAt))
		.limit(25);

	return c.json({
		totals,
		organizations: organizations.slice(0, limit),
		recentTopUps: recentRows.map((row) => ({
			id: row.id,
			createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
			organizationId: row.organizationId,
			organizationName: row.organizationName,
			endCustomerId: row.endCustomerId,
			endCustomerExternalId: row.endCustomerExternalId,
			mode: row.mode,
			grossPaid: num(row.grossPaid),
			platformFee: num(row.platformFee),
			developerMargin: num(row.developerMargin),
			netCredited: num(row.netCredited),
			refunded: Boolean(row.refunded),
			stripePaymentIntentId: row.stripePaymentIntentId,
		})),
		days,
		mode,
	});
});

export default adminSdk;
