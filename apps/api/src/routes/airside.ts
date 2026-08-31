import { randomBytes } from "node:crypto";

import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	dematerializeAirsideModel,
	staticCatalogueHasActiveMapping,
	syncAirsideModelMetadata,
} from "@/lib/airside-catalogue.js";
import { domainPublishesToken } from "@/lib/airside-dns.js";
import {
	acceptedClaimDomains,
	claimableProvidersForDomains,
	emailRegistrableDomain,
	isFreemailDomain,
	registrableDomain,
	verifiedWebsiteDomain,
	WEBSITE_VERIFICATION_TXT_NAME,
	websiteVerificationRecord,
} from "@/lib/airside-domains.js";
import { notifyAirsideCrewInvite } from "@/utils/discord.js";

import {
	AIRSIDE_BASELINE_MARGIN,
	AIRSIDE_DISCOUNT_MAX,
	AIRSIDE_MARGIN_MAX,
	AIRSIDE_MARGIN_MIN,
	and,
	cdb,
	computeAirsideAdjustment,
	db,
	desc,
	eq,
	gte,
	inArray,
	sql,
	tables,
} from "@llmgateway/db";
import {
	models as catalogueModels,
	providers as catalogueProviders,
} from "@llmgateway/models";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import { getStripe } from "./payments.js";

import type { ServerTypes } from "@/vars.js";
import type { ProviderModelMapping } from "@llmgateway/models";

/**
 * Airside — the self-serve provider portal. Provider companies ("carriers")
 * claim catalogue providers by verified email domain, list models whose
 * pricing only changes through admin-approved filings, watch usage of their
 * providers, and tune the routing knobs (traffic discount + accepted gateway
 * margin) that feed the routing election.
 */

export const airside = new OpenAPIHono<ServerTypes>();

// Listing-fee gate: only enforced when the Stripe price is configured, so
// self-hosted installs without billing keep a working portal.
export function airsideListingFeeRequired(): boolean {
	return Boolean(process.env.AIRSIDE_LISTING_PRICE_ID);
}

// The advertised fee comes straight from the configured Stripe price, so the
// portal can never display a number Stripe would not actually charge.
async function getListingFeeAmount(): Promise<number | null> {
	const priceId = process.env.AIRSIDE_LISTING_PRICE_ID;
	if (!priceId) {
		return null;
	}
	try {
		const price = await getStripe().prices.retrieve(priceId);
		return price.unit_amount !== null ? price.unit_amount / 100 : null;
	} catch {
		// An unconfigured or unreachable Stripe degrades to "amount unknown"
		// instead of breaking onboarding — checkout still enforces the price.
		return null;
	}
}

// Crew size cap: the owner plus invited teammates, pending invites included.
export const AIRSIDE_CREW_MAX = 10;

// Uploaded branding is stored inline as data URLs; keep them small. SVG only:
// vector marks scale cleanly everywhere the branding renders (cards, hero,
// OG images), and one accepted format keeps review simple.
const LOGO_MAX_BYTES = 200 * 1024;
const ICON_MAX_BYTES = 64 * 1024;
const DATA_URL_PATTERN = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/;

function imageDataUrl(maxBytes: number) {
	return z
		.string()
		.regex(DATA_URL_PATTERN, "Must be a base64 SVG data URL")
		.refine((v) => v.length <= Math.ceil(maxBytes * 1.4), {
			message: `Image must be smaller than ${Math.round(maxBytes / 1024)}KB`,
		});
}

// Plain decimal or scientific notation only — Number("") and Number("0x1F")
// would otherwise slip through as 0 / 31.
const PRICE_PATTERN = /^\d+(\.\d+)?([eE][+-]?\d+)?$/;

const priceValue = z
	.string()
	.refine((v) => PRICE_PATTERN.test(v) && Number.isFinite(Number(v)), {
		message: "Price must be a non-negative decimal number string",
	});

const REASONING_EFFORT_VALUES = [
	"none",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
const reasoningEffortsValue = z.array(z.enum(REASONING_EFFORT_VALUES)).max(7);

const pricingSchema = z.object({
	inputPrice: priceValue,
	outputPrice: priceValue,
	cachedInputPrice: priceValue.optional(),
	requestPrice: priceValue.optional(),
});

const claimSchema = z.object({
	id: z.string(),
	providerCompanyId: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	kind: z.enum(["catalogue", "custom"]),
	matchedDomain: z.string(),
	// Custom carriers only: the registered OpenAI-compatible endpoint.
	customBaseUrl: z.string().nullable(),
	status: z.enum(["pending", "active", "rejected", "revoked"]),
	// Set when we rejected the claim — shown to the company.
	reviewNote: z.string().nullable(),
	logoUrl: z.string().nullable(),
	iconUrl: z.string().nullable(),
	// Whether we hold a platform credential for this carrier. Without one the
	// gateway has nothing to authenticate with, so an approved listing still
	// serves no traffic — the portal says so instead of looking healthy.
	hasManagedCredential: z.boolean(),
	createdAt: z.string(),
});

const companySchema = z.object({
	id: z.string(),
	name: z.string(),
	website: z.string().nullable(),
	// DNS proof of the website's domain. `websiteVerifiedDomain` is non-null
	// only while the proof still covers the current `website`.
	websiteVerifiedDomain: z.string().nullable(),
	websiteVerifiedAt: z.string().nullable(),
	role: z.enum(["owner", "member"]),
	paymentStatus: z.enum(["unpaid", "paid"]),
	// Whether this deployment enforces the listing fee at all.
	paymentRequired: z.boolean(),
	// The fee in USD, read from the Stripe price. Null when no fee is
	// configured, when it is already settled, or when Stripe is unreachable.
	listingFeeAmount: z.number().nullable(),
	// True when the fee was waived with an invite code rather than paid.
	listingInviteCodeUsed: z.boolean(),
	createdAt: z.string(),
	claims: z.array(claimSchema),
});

const crewMemberSchema = z.object({
	id: z.string(),
	role: z.enum(["owner", "member"]),
	email: z.string(),
	name: z.string().nullable(),
	createdAt: z.string(),
});

const crewInviteSchema = z.object({
	id: z.string(),
	email: z.string(),
	createdAt: z.string(),
});

const filingSchema = z.object({
	id: z.string(),
	draftModelId: z.string(),
	providerCompanyId: z.string(),
	kind: z.enum(["initial", "update"]),
	inputPrice: z.string(),
	outputPrice: z.string(),
	cachedInputPrice: z.string().nullable(),
	requestPrice: z.string().nullable(),
	status: z.enum(["pending", "approved", "rejected"]),
	note: z.string().nullable(),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
});

const modelSchema = z.object({
	id: z.string(),
	providerCompanyId: z.string(),
	providerId: z.string(),
	modelName: z.string(),
	displayName: z.string().nullable(),
	description: z.string().nullable(),
	family: z.string().nullable(),
	contextSize: z.number().nullable(),
	maxOutput: z.number().nullable(),
	streaming: z.boolean(),
	vision: z.boolean(),
	audio: z.boolean(),
	tools: z.boolean(),
	jsonOutput: z.boolean(),
	reasoning: z.boolean(),
	// Supported unified reasoning_effort tiers; null = unsupported.
	reasoningEfforts: z.array(z.enum(REASONING_EFFORT_VALUES)).nullable(),
	// Carrier-managed request caps; admin rate limits take precedence.
	maxRpm: z.number().nullable(),
	maxRpd: z.number().nullable(),
	// "global" = one counter across all organizations, "per_org" = one each.
	rateLimitScope: z.enum(["global", "per_org"]),
	status: z.enum(["draft", "active", "rejected", "delisted"]),
	createdAt: z.string(),
	updatedAt: z.string(),
	currentPricing: filingSchema.nullable(),
	pendingFiling: filingSchema.nullable(),
});

const routingFilingSchema = z.object({
	id: z.string(),
	providerCompanyId: z.string(),
	providerId: z.string(),
	discountPercent: z.number(),
	marginPercent: z.number(),
	routingAdjustment: z.number(),
	status: z.enum(["pending", "approved", "rejected"]),
	reviewNote: z.string().nullable(),
	reviewedAt: z.string().nullable(),
	createdAt: z.string(),
});

const routingSettingsSchema = z.object({
	providerId: z.string(),
	providerCompanyId: z.string(),
	discountPercent: z.number(),
	marginPercent: z.number(),
	// The signed routing-price adjustment the carrier's settings produce
	// (negative = boosted, i.e. routed as if cheaper). The gateway applies it
	// directly; admin provider prioritization is a separate internal knob.
	routingAdjustment: z.number(),
	updatedAt: z.string().nullable(),
	// The fare change awaiting admin approval, if any.
	pendingFiling: routingFilingSchema.nullable(),
});

type RoutingFilingRow = typeof tables.providerRoutingFiling.$inferSelect;

function serializeRoutingFiling(row: RoutingFilingRow) {
	const discountPercent = Number(row.discountPercent);
	const marginPercent = Number(row.marginPercent);
	return {
		id: row.id,
		providerCompanyId: row.providerCompanyId,
		providerId: row.providerId,
		discountPercent,
		marginPercent,
		routingAdjustment: computeAirsideAdjustment(discountPercent, marginPercent),
		status: row.status,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	};
}

type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;
type PriceFilingRow = typeof tables.providerPriceFiling.$inferSelect;
type DraftModelRow = typeof tables.providerDraftModel.$inferSelect;

function serializeClaim(
	row: ProviderClaimRow,
	providerNames: Map<string, string>,
	credentialedProviders?: Set<string>,
) {
	return {
		id: row.id,
		providerCompanyId: row.providerCompanyId,
		providerId: row.providerId,
		providerName:
			row.kind === "custom"
				? (row.customName ?? row.providerId)
				: (providerNames.get(row.providerId) ?? row.providerId),
		kind: row.kind,
		matchedDomain: row.matchedDomain,
		customBaseUrl: row.customBaseUrl,
		status: row.status,
		reviewNote: row.reviewNote,
		logoUrl: row.logoUrl,
		iconUrl: row.iconUrl,
		// Unknown on the single-claim responses (nothing renders the warning
		// off those); the companies listing the portal polls resolves it.
		hasManagedCredential: credentialedProviders?.has(row.providerId) ?? true,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Providers we hold a live platform credential for, out of the given ids.
 * Catalogue providers may also be keyed from the environment, which no DB row
 * records — so those count as credentialed and never raise the warning.
 */
async function credentialedProviderIds(
	providerIds: string[],
): Promise<Set<string>> {
	if (providerIds.length === 0) {
		return new Set();
	}
	const keys = await db.query.providerKey.findMany({
		where: {
			managed: { eq: true },
			status: { ne: "deleted" },
			provider: { in: providerIds },
		},
		columns: { provider: true },
	});
	const withKey = new Set(keys.map((key) => key.provider));
	for (const id of providerIds) {
		if (catalogueProviders.some((p) => p.id === id)) {
			withKey.add(id);
		}
	}
	return withKey;
}

function serializeFiling(row: PriceFilingRow) {
	return {
		id: row.id,
		draftModelId: row.draftModelId,
		providerCompanyId: row.providerCompanyId,
		kind: row.kind,
		inputPrice: row.inputPrice,
		outputPrice: row.outputPrice,
		cachedInputPrice: row.cachedInputPrice,
		requestPrice: row.requestPrice,
		status: row.status,
		note: row.note,
		reviewNote: row.reviewNote,
		reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
		createdAt: row.createdAt.toISOString(),
	};
}

function serializeModel(
	row: DraftModelRow & { priceFilings?: PriceFilingRow[] },
) {
	const filings = [...(row.priceFilings ?? [])].sort(
		(a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
	);
	const approved = filings.find((f) => f.status === "approved");
	const pending = filings.find((f) => f.status === "pending");
	return {
		id: row.id,
		providerCompanyId: row.providerCompanyId,
		providerId: row.providerId,
		modelName: row.modelName,
		displayName: row.displayName,
		description: row.description,
		family: row.family,
		contextSize: row.contextSize,
		maxOutput: row.maxOutput,
		streaming: row.streaming,
		vision: row.vision,
		audio: row.audio,
		tools: row.tools,
		jsonOutput: row.jsonOutput,
		reasoning: row.reasoning,
		reasoningEfforts: (row.reasoningEfforts ?? null) as
			(typeof REASONING_EFFORT_VALUES)[number][] | null,
		maxRpm: row.maxRpm,
		maxRpd: row.maxRpd,
		rateLimitScope: row.rateLimitScope,
		status: row.status,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		currentPricing: approved ? serializeFiling(approved) : null,
		pendingFiling: pending ? serializeFiling(pending) : null,
	};
}

interface SessionUserLike {
	id: string;
	email: string;
	emailVerified: boolean;
}

function requireUser(user: SessionUserLike | null): SessionUserLike {
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	return user;
}

function requireVerifiedUser(user: SessionUserLike | null): SessionUserLike {
	const resolved = requireUser(user);
	if (!resolved.emailVerified) {
		throw new HTTPException(403, {
			message: "Verify your email address before performing this action.",
		});
	}
	return resolved;
}

/** Postgres unique-constraint violation (used to detect insert races). */
function isUniqueViolation(err: unknown): boolean {
	const code =
		(err as { code?: string; cause?: { code?: string } })?.code ??
		(err as { cause?: { code?: string } })?.cause?.code;
	return code === "23505";
}

async function requireCompanyMembership(
	userId: string,
	providerCompanyId: string,
) {
	const membership = await db.query.providerCompanyMember.findFirst({
		where: {
			providerCompanyId: { eq: providerCompanyId },
			userId: { eq: userId },
		},
	});
	if (!membership) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	return membership;
}

/**
 * Every registrable domain this user may claim on: their verified email
 * domain plus any domain one of their companies proved over DNS.
 */
async function userClaimDomains(user: {
	id: string;
	email: string;
}): Promise<Set<string>> {
	const memberships = await db.query.providerCompanyMember.findMany({
		where: { userId: { eq: user.id } },
		with: { providerCompany: true },
	});
	const domains = acceptedClaimDomains(user.email, null);
	for (const membership of memberships) {
		const company = membership.providerCompany;
		if (!company) {
			continue;
		}
		const verified = verifiedWebsiteDomain(company);
		if (verified) {
			domains.add(verified);
		}
	}
	return domains;
}

async function getActiveClaimedProviderIds(
	providerCompanyId: string,
): Promise<string[]> {
	const claims = await db.query.providerClaim.findMany({
		where: {
			providerCompanyId: { eq: providerCompanyId },
			status: { eq: "active" },
		},
	});
	return claims.map((claim) => claim.providerId);
}

const providerNamesById = new Map(
	catalogueProviders.map((p) => [p.id, p.name]),
);

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

const listCompanies = createRoute({
	method: "get",
	path: "/companies",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ companies: z.array(companySchema) }),
				},
			},
			description: "Provider companies the user belongs to.",
		},
	},
});

/**
 * Attach crew invites addressed to this verified email: the invitee just
 * signs up and opens the portal — no invite-email round trip. Safe to run on
 * every listing; the pending status and unique member index make it a no-op
 * after the first time.
 */
async function attachPendingCrewInvites(user: {
	id: string;
	email: string;
	emailVerified: boolean;
}) {
	if (!user.emailVerified) {
		return;
	}
	const invites = await db.query.providerCompanyInvite.findMany({
		where: {
			email: { eq: user.email.toLowerCase() },
			status: { eq: "pending" },
		},
	});
	for (const invite of invites) {
		try {
			await db.transaction(async (tx) => {
				await tx.insert(tables.providerCompanyMember).values({
					providerCompanyId: invite.providerCompanyId,
					userId: user.id,
					role: "member",
				});
				await tx
					.update(tables.providerCompanyInvite)
					.set({ status: "accepted", acceptedAt: new Date() })
					.where(eq(tables.providerCompanyInvite.id, invite.id));
			});
		} catch (err) {
			if (!isUniqueViolation(err)) {
				throw err;
			}
			// Already a member — settle the invite anyway.
			await db
				.update(tables.providerCompanyInvite)
				.set({ status: "accepted", acceptedAt: new Date() })
				.where(eq(tables.providerCompanyInvite.id, invite.id));
		}
	}
}

airside.openapi(listCompanies, async (c) => {
	const user = requireUser(c.get("user"));
	await attachPendingCrewInvites(user);
	const memberships = await db.query.providerCompanyMember.findMany({
		where: { userId: { eq: user.id } },
		with: { providerCompany: { with: { claims: true } } },
		orderBy: { createdAt: "asc" },
	});
	const providerNames = providerNamesById;
	const credentialed = await credentialedProviderIds([
		...new Set(
			memberships.flatMap(
				(m) => m.providerCompany?.claims.map((claim) => claim.providerId) ?? [],
			),
		),
	]);
	// Only fetch the Stripe amount while someone still has the fee ahead of
	// them — the paid state never renders it.
	const feeAmount =
		airsideListingFeeRequired() &&
		memberships.some((m) => m.providerCompany?.paymentStatus === "unpaid")
			? await getListingFeeAmount()
			: null;
	return c.json({
		companies: memberships.flatMap((m) => {
			const company = m.providerCompany;
			if (!company) {
				return [];
			}
			const verifiedDomain = verifiedWebsiteDomain(company) ?? null;
			return [
				{
					id: company.id,
					name: company.name,
					website: company.website,
					websiteVerifiedDomain: verifiedDomain,
					websiteVerifiedAt: verifiedDomain
						? (company.websiteVerifiedAt?.toISOString() ?? null)
						: null,
					role: m.role,
					paymentStatus: company.paymentStatus,
					paymentRequired: airsideListingFeeRequired(),
					listingFeeAmount:
						company.paymentStatus === "unpaid" ? feeAmount : null,
					listingInviteCodeUsed: Boolean(company.listingInviteCode),
					createdAt: company.createdAt.toISOString(),
					claims: company.claims
						// Rejected claims stay visible so the carrier sees the
						// review note; only revoked ones disappear.
						.filter((claim) => claim.status !== "revoked")
						.map((claim) => serializeClaim(claim, providerNames, credentialed)),
				},
			];
		}),
	});
});

const createCompany = createRoute({
	method: "post",
	path: "/companies",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().min(2).max(100),
						website: z.string().url().optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ company: companySchema }),
				},
			},
			description: "The created provider company.",
		},
	},
});

airside.openapi(createCompany, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { name, website } = c.req.valid("json");
	const company = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(tables.providerCompany)
			.values({ name, website: website ?? null })
			.returning();
		await tx.insert(tables.providerCompanyMember).values({
			providerCompanyId: created.id,
			userId: user.id,
			role: "owner",
		});
		return created;
	});
	return c.json(
		{
			company: {
				id: company.id,
				name: company.name,
				website: company.website,
				websiteVerifiedDomain: null,
				websiteVerifiedAt: null,
				role: "owner" as const,
				paymentStatus: company.paymentStatus,
				paymentRequired: airsideListingFeeRequired(),
				listingFeeAmount: airsideListingFeeRequired()
					? await getListingFeeAmount()
					: null,
				listingInviteCodeUsed: false,
				createdAt: company.createdAt.toISOString(),
				claims: [],
			},
		},
		201,
	);
});

// ---------------------------------------------------------------------------
// Website domain verification (DNS TXT)
// ---------------------------------------------------------------------------

const websiteVerificationSchema = z.object({
	// The domain the token must be published on, derived from `website`.
	domain: z.string().nullable(),
	recordName: z.string(),
	recordValue: z.string().nullable(),
	verifiedDomain: z.string().nullable(),
	verifiedAt: z.string().nullable(),
});

const getWebsiteVerification = createRoute({
	method: "get",
	path: "/companies/{id}/website-verification",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: websiteVerificationSchema },
			},
			description: "The DNS record that proves the company's website domain.",
		},
	},
});

/**
 * Issues the company's verification token on first read and keeps it stable
 * afterwards, so the record a carrier already published stays valid.
 */
async function ensureVerificationToken(company: {
	id: string;
	websiteVerificationToken: string | null;
}): Promise<string> {
	if (company.websiteVerificationToken) {
		return company.websiteVerificationToken;
	}
	const token = randomBytes(16).toString("hex");
	await db
		.update(tables.providerCompany)
		.set({ websiteVerificationToken: token })
		.where(eq(tables.providerCompany.id, company.id));
	return token;
}

function websiteDomainOf(website: string | null): string | null {
	if (!website) {
		return null;
	}
	try {
		return registrableDomain(new URL(website).hostname);
	} catch {
		return null;
	}
}

airside.openapi(getWebsiteVerification, async (c) => {
	const user = requireUser(c.get("user"));
	const { id } = c.req.valid("param");
	await requireCompanyMembership(user.id, id);
	const company = await db.query.providerCompany.findFirst({
		where: { id: { eq: id } },
	});
	if (!company) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	const domain = websiteDomainOf(company.website);
	const verified = verifiedWebsiteDomain(company) ?? null;
	return c.json({
		domain,
		recordName: WEBSITE_VERIFICATION_TXT_NAME,
		recordValue: domain
			? websiteVerificationRecord(await ensureVerificationToken(company))
			: null,
		verifiedDomain: verified,
		verifiedAt: verified
			? (company.websiteVerifiedAt?.toISOString() ?? null)
			: null,
	});
});

const checkWebsiteVerification = createRoute({
	method: "post",
	path: "/companies/{id}/website-verification",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": { schema: websiteVerificationSchema },
			},
			description: "Re-resolves the TXT record and records the result.",
		},
	},
});

airside.openapi(checkWebsiteVerification, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	await requireCompanyMembership(user.id, id);
	const company = await db.query.providerCompany.findFirst({
		where: { id: { eq: id } },
	});
	if (!company) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	const domain = websiteDomainOf(company.website);
	if (!domain) {
		throw new HTTPException(400, {
			message: "Add your company website before verifying its domain.",
		});
	}
	const token = await ensureVerificationToken(company);
	const found = await domainPublishesToken(
		WEBSITE_VERIFICATION_TXT_NAME,
		domain,
		token,
	);
	if (!found) {
		throw new HTTPException(400, {
			message: `No matching TXT record on ${WEBSITE_VERIFICATION_TXT_NAME}.${domain} yet. DNS changes can take a few minutes to propagate.`,
		});
	}
	const [updated] = await db
		.update(tables.providerCompany)
		.set({ websiteVerifiedDomain: domain, websiteVerifiedAt: new Date() })
		.where(eq(tables.providerCompany.id, id))
		.returning();
	return c.json({
		domain,
		recordName: WEBSITE_VERIFICATION_TXT_NAME,
		recordValue: websiteVerificationRecord(token),
		verifiedDomain: updated.websiteVerifiedDomain,
		verifiedAt: updated.websiteVerifiedAt?.toISOString() ?? null,
	});
});

// ---------------------------------------------------------------------------
// Crew channel invite
// ---------------------------------------------------------------------------

const requestCrewInvite = createRoute({
	method: "post",
	path: "/companies/{id}/crew-invite",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ email: z.string() }),
				},
			},
			description:
				"Notifies our crew to invite the caller to the carrier channel.",
		},
	},
});

/**
 * Carriers get a shared channel with our team. There is no self-serve invite
 * API on our side yet, so the request lands in the same Discord channel as
 * provider listing requests and we invite the address by hand.
 */
airside.openapi(requestCrewInvite, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	await requireCompanyMembership(user.id, id);
	const company = await db.query.providerCompany.findFirst({
		where: { id: { eq: id } },
		with: { claims: true },
	});
	if (!company) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	await notifyAirsideCrewInvite({
		companyName: company.name,
		email: user.email,
		website: company.website,
		carriers: company.claims
			.filter((claim) => claim.status !== "revoked")
			.map((claim) => `${claim.providerId} (${claim.kind}, ${claim.status})`),
	});
	return c.json({ email: user.email });
});

const createListingCheckout = createRoute({
	method: "post",
	path: "/companies/{id}/listing-checkout",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ checkoutUrl: z.string() }),
				},
			},
			description:
				"Stripe hosted-checkout URL for the one-time carrier listing fee.",
		},
	},
});

airside.openapi(createListingCheckout, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	await requireCompanyMembership(user.id, id);
	const company = await db.query.providerCompany.findFirst({
		where: { id: { eq: id } },
	});
	if (!company) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	if (company.paymentStatus === "paid") {
		throw new HTTPException(409, {
			message: "The listing fee has already been paid.",
		});
	}
	const priceId = process.env.AIRSIDE_LISTING_PRICE_ID;
	if (!priceId) {
		throw new HTTPException(400, {
			message: "The listing fee is not configured on this deployment.",
		});
	}
	// A deployment that charges the fee must also say where Stripe should send
	// the customer back — a localhost fallback would strand a paid customer.
	const airsideUrl = process.env.AIRSIDE_URL;
	if (!airsideUrl && process.env.NODE_ENV === "production") {
		throw new HTTPException(500, {
			message: "AIRSIDE_URL must be configured to charge the listing fee.",
		});
	}
	const returnBase = airsideUrl ?? "http://localhost:3007";

	// Reuse a still-open session so repeat clicks (or two tabs) cannot buy the
	// one-time fee twice; expired/consumed sessions fall through to a new one.
	if (company.stripeCheckoutSessionId) {
		const existing = await getStripe()
			.checkout.sessions.retrieve(company.stripeCheckoutSessionId)
			.catch(() => null);
		if (existing?.status === "open" && existing.url) {
			return c.json({ checkoutUrl: existing.url });
		}
	}

	const session = await getStripe().checkout.sessions.create({
		mode: "payment",
		line_items: [{ price: priceId, quantity: 1 }],
		customer_email: user.email,
		success_url: `${returnBase}/onboarding?payment=success`,
		cancel_url: `${returnBase}/onboarding?payment=canceled`,
		metadata: {
			type: "airside_listing_fee",
			providerCompanyId: company.id,
		},
		payment_intent_data: {
			metadata: {
				type: "airside_listing_fee",
				providerCompanyId: company.id,
			},
		},
	});
	if (!session.url) {
		throw new HTTPException(500, {
			message: "Stripe did not return a checkout URL.",
		});
	}
	// Remember the open session for the reuse guard above.
	await db
		.update(tables.providerCompany)
		.set({ stripeCheckoutSessionId: session.id })
		.where(
			and(
				eq(tables.providerCompany.id, company.id),
				eq(tables.providerCompany.paymentStatus, "unpaid"),
			),
		);
	return c.json({ checkoutUrl: session.url });
});

const redeemInviteCode = createRoute({
	method: "post",
	path: "/companies/{id}/invite-code",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ code: z.string().min(1).max(100) }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ paymentStatus: z.literal("paid") }),
				},
			},
			description: "The listing fee was waived with a valid invite code.",
		},
	},
});

airside.openapi(redeemInviteCode, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const { code } = c.req.valid("json");
	await requireCompanyMembership(user.id, id);
	const company = await db.query.providerCompany.findFirst({
		where: { id: { eq: id } },
	});
	if (!company) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	if (!airsideListingFeeRequired()) {
		throw new HTTPException(400, {
			message: "There is no listing fee on this deployment.",
		});
	}
	if (company.paymentStatus === "paid") {
		throw new HTTPException(409, {
			message: "The listing fee has already been settled.",
		});
	}
	// Codes are minted uppercase in the admin dashboard; accept any casing.
	const normalized = code.trim().toUpperCase();
	// One transaction: consuming a use and clearing the fee either both land
	// or neither does, and the guarded UPDATEs make concurrent redeems (or a
	// racing Stripe webhook) lose cleanly instead of double-spending.
	await db.transaction(async (tx) => {
		const consumed = await tx
			.update(tables.airsideInviteCode)
			.set({
				usedCount: sql`${tables.airsideInviteCode.usedCount} + 1`,
			})
			.where(
				and(
					eq(tables.airsideInviteCode.code, normalized),
					sql`${tables.airsideInviteCode.revokedAt} IS NULL`,
					sql`${tables.airsideInviteCode.usedCount} < ${tables.airsideInviteCode.maxUses}`,
				),
			)
			.returning({ id: tables.airsideInviteCode.id });
		if (consumed.length === 0) {
			throw new HTTPException(400, {
				message: "That invite code isn't valid.",
			});
		}
		const updated = await tx
			.update(tables.providerCompany)
			.set({
				paymentStatus: "paid",
				paidAt: new Date(),
				listingInviteCode: normalized,
			})
			.where(
				and(
					eq(tables.providerCompany.id, id),
					eq(tables.providerCompany.paymentStatus, "unpaid"),
				),
			)
			.returning({ id: tables.providerCompany.id });
		if (updated.length === 0) {
			throw new HTTPException(409, {
				message: "The listing fee has already been settled.",
			});
		}
	});
	return c.json({ paymentStatus: "paid" as const });
});

// ---------------------------------------------------------------------------
// Crew (company members)
// ---------------------------------------------------------------------------

async function requireCompanyOwnership(userId: string, companyId: string) {
	const membership = await requireCompanyMembership(userId, companyId);
	if (membership.role !== "owner") {
		throw new HTTPException(403, {
			message: "Only company owners can manage the crew.",
		});
	}
	return membership;
}

const listCrew = createRoute({
	method: "get",
	path: "/companies/{id}/members",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						members: z.array(crewMemberSchema),
						invites: z.array(crewInviteSchema),
						viewerRole: z.enum(["owner", "member"]),
						limit: z.number(),
					}),
				},
			},
			description: "Crew members and pending invites for the company.",
		},
	},
});

airside.openapi(listCrew, async (c) => {
	const user = requireUser(c.get("user"));
	const { id } = c.req.valid("param");
	const membership = await requireCompanyMembership(user.id, id);
	const [members, invites] = await Promise.all([
		db.query.providerCompanyMember.findMany({
			where: { providerCompanyId: { eq: id } },
			with: { user: true },
			orderBy: { createdAt: "asc" },
		}),
		db.query.providerCompanyInvite.findMany({
			where: { providerCompanyId: { eq: id }, status: { eq: "pending" } },
			orderBy: { createdAt: "asc" },
		}),
	]);
	return c.json({
		members: members.map((member) => ({
			id: member.id,
			role: member.role,
			email: member.user?.email ?? "",
			name: member.user?.name ?? null,
			createdAt: member.createdAt.toISOString(),
		})),
		invites: invites.map((invite) => ({
			id: invite.id,
			email: invite.email,
			createdAt: invite.createdAt.toISOString(),
		})),
		viewerRole: membership.role,
		limit: AIRSIDE_CREW_MAX,
	});
});

const inviteCrewMember = createRoute({
	method: "post",
	path: "/companies/{id}/members",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ email: z.string().email().max(320) }),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						// Exactly one is set: `member` when an account with that
						// email already exists, `invite` when it has to wait.
						member: crewMemberSchema.nullable(),
						invite: crewInviteSchema.nullable(),
					}),
				},
			},
			description: "The attached member, or the pending invite.",
		},
	},
});

airside.openapi(inviteCrewMember, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	await requireCompanyOwnership(user.id, id);
	const company = await db.query.providerCompany.findFirst({
		where: { id: { eq: id } },
		with: { claims: true },
	});
	if (!company) {
		throw new HTTPException(404, { message: "Provider company not found" });
	}
	const email = body.email.trim().toLowerCase();
	// Crew stays on the team's own domains — the same domains that prove the
	// company's carrier claims. Anything else would let a claim verified on
	// one domain be operated from an unrelated mailbox.
	const emailDomain = emailRegistrableDomain(email);
	const allowedDomains = new Set<string>();
	const inviterDomain = emailRegistrableDomain(user.email);
	if (inviterDomain && !isFreemailDomain(inviterDomain)) {
		allowedDomains.add(inviterDomain);
	}
	const verified = verifiedWebsiteDomain(company);
	if (verified) {
		allowedDomains.add(verified);
	}
	for (const claim of company.claims) {
		if (claim.status !== "revoked") {
			allowedDomains.add(claim.matchedDomain);
		}
	}
	if (!emailDomain || !allowedDomains.has(emailDomain)) {
		throw new HTTPException(400, {
			message: `Crew invites are limited to your team's domains (${[...allowedDomains].sort().join(", ") || "none available"}).`,
		});
	}
	const [members, invites] = await Promise.all([
		db.query.providerCompanyMember.findMany({
			where: { providerCompanyId: { eq: id } },
			with: { user: true },
		}),
		db.query.providerCompanyInvite.findMany({
			where: { providerCompanyId: { eq: id }, status: { eq: "pending" } },
		}),
	]);
	if (members.length + invites.length >= AIRSIDE_CREW_MAX) {
		throw new HTTPException(400, {
			message: `A carrier crew is limited to ${AIRSIDE_CREW_MAX} members, pending invites included.`,
		});
	}
	if (members.some((m) => m.user?.email.toLowerCase() === email)) {
		throw new HTTPException(409, {
			message: "That person is already a crew member.",
		});
	}
	if (invites.some((invite) => invite.email === email)) {
		throw new HTTPException(409, {
			message: "That email has already been invited.",
		});
	}
	const existingUser = await db.query.user.findFirst({
		where: { email: { eq: email } },
	});
	if (existingUser) {
		try {
			const [member] = await db
				.insert(tables.providerCompanyMember)
				.values({
					providerCompanyId: id,
					userId: existingUser.id,
					role: "member",
				})
				.returning();
			return c.json(
				{
					member: {
						id: member.id,
						role: member.role,
						email: existingUser.email,
						name: existingUser.name ?? null,
						createdAt: member.createdAt.toISOString(),
					},
					invite: null,
				},
				201,
			);
		} catch (err) {
			if (isUniqueViolation(err)) {
				throw new HTTPException(409, {
					message: "That person is already a crew member.",
				});
			}
			throw err;
		}
	}
	try {
		const [invite] = await db
			.insert(tables.providerCompanyInvite)
			.values({ providerCompanyId: id, email, invitedBy: user.id })
			.returning();
		return c.json(
			{
				member: null,
				invite: {
					id: invite.id,
					email: invite.email,
					createdAt: invite.createdAt.toISOString(),
				},
			},
			201,
		);
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new HTTPException(409, {
				message: "That email has already been invited.",
			});
		}
		throw err;
	}
});

const removeCrewMember = createRoute({
	method: "delete",
	path: "/companies/{id}/members/{memberId}",
	request: {
		params: z.object({ id: z.string(), memberId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ removed: z.literal(true) }),
				},
			},
			description: "The member was removed from the crew.",
		},
	},
});

airside.openapi(removeCrewMember, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id, memberId } = c.req.valid("param");
	await requireCompanyOwnership(user.id, id);
	const member = await db.query.providerCompanyMember.findFirst({
		where: { id: { eq: memberId }, providerCompanyId: { eq: id } },
	});
	if (!member) {
		throw new HTTPException(404, { message: "Crew member not found" });
	}
	if (member.role === "owner") {
		throw new HTTPException(400, {
			message: "Owners cannot be removed from the crew.",
		});
	}
	await db
		.delete(tables.providerCompanyMember)
		.where(eq(tables.providerCompanyMember.id, memberId));
	return c.json({ removed: true as const });
});

const revokeCrewInvite = createRoute({
	method: "delete",
	path: "/companies/{id}/invites/{inviteId}",
	request: {
		params: z.object({ id: z.string(), inviteId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ revoked: z.literal(true) }),
				},
			},
			description: "The pending invite was revoked.",
		},
	},
});

airside.openapi(revokeCrewInvite, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id, inviteId } = c.req.valid("param");
	await requireCompanyOwnership(user.id, id);
	const deleted = await db
		.delete(tables.providerCompanyInvite)
		.where(
			and(
				eq(tables.providerCompanyInvite.id, inviteId),
				eq(tables.providerCompanyInvite.providerCompanyId, id),
				eq(tables.providerCompanyInvite.status, "pending"),
			),
		)
		.returning({ id: tables.providerCompanyInvite.id });
	if (deleted.length === 0) {
		throw new HTTPException(404, { message: "Pending invite not found" });
	}
	return c.json({ revoked: true as const });
});

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

const listClaimable = createRoute({
	method: "get",
	path: "/claimable",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						emailDomain: z.string().nullable(),
						// Personal email provider (gmail, hotmail, …): the account can
						// neither claim nor register a carrier.
						emailDomainIsFreemail: z.boolean(),
						emailVerified: z.boolean(),
						providers: z.array(
							z.object({
								providerId: z.string(),
								name: z.string(),
								matchedDomain: z.string(),
								claimed: z.boolean(),
								claimedByMyCompany: z.boolean(),
								myClaimStatus: z
									.enum(["pending", "active", "rejected", "revoked"])
									.nullable(),
							}),
						),
					}),
				},
			},
			description:
				"Catalogue providers whose endpoint domain matches the user's email domain.",
		},
	},
});

airside.openapi(listClaimable, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const claimDomains = await userClaimDomains(user);
	const matches = claimableProvidersForDomains(claimDomains);
	const claims = matches.length
		? await db.query.providerClaim.findMany({
				where: {
					providerId: { in: matches.map((m) => m.providerId) },
					status: { in: ["pending", "active"] },
				},
			})
		: [];
	const memberships = await db.query.providerCompanyMember.findMany({
		where: { userId: { eq: user.id } },
	});
	const myCompanyIds = new Set(memberships.map((m) => m.providerCompanyId));
	const claimByProvider = new Map(claims.map((cl) => [cl.providerId, cl]));
	const emailDomain = emailRegistrableDomain(user.email) ?? null;
	return c.json({
		// Always report the domain we matched against, so the onboarding view
		// can explain a miss ("no provider matches @example.com").
		emailDomain,
		emailDomainIsFreemail: isFreemailDomain(emailDomain ?? undefined),
		emailVerified: user.emailVerified,
		providers: matches.map((m) => {
			const existing = claimByProvider.get(m.providerId);
			const mine = existing
				? myCompanyIds.has(existing.providerCompanyId)
				: false;
			return {
				providerId: m.providerId,
				name: m.name,
				matchedDomain: m.matchedDomain,
				claimed: !!existing,
				claimedByMyCompany: mine,
				myClaimStatus: mine && existing ? existing.status : null,
			};
		}),
	});
});

const createClaim = createRoute({
	method: "post",
	path: "/claims",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						providerId: z.string(),
						logoUrl: imageDataUrl(LOGO_MAX_BYTES).optional(),
						iconUrl: imageDataUrl(ICON_MAX_BYTES).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ claim: claimSchema }),
				},
			},
			description: "The created provider claim.",
		},
	},
});

airside.openapi(createClaim, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { providerCompanyId, providerId, logoUrl, iconUrl } =
		c.req.valid("json");
	await requireCompanyMembership(user.id, providerCompanyId);

	if (airsideListingFeeRequired()) {
		const company = await db.query.providerCompany.findFirst({
			where: { id: { eq: providerCompanyId } },
		});
		if (company?.paymentStatus !== "paid") {
			throw new HTTPException(402, {
				message: "Pay the listing fee before claiming a carrier.",
			});
		}
	}

	const claimDomains = await userClaimDomains(user);
	const match = claimableProvidersForDomains(claimDomains).find(
		(m) => m.providerId === providerId,
	);
	if (!match) {
		throw new HTTPException(403, {
			message:
				"Neither your email domain nor a DNS-verified company domain matches this provider's API endpoint domain.",
		});
	}

	const existing = await db.query.providerClaim.findFirst({
		where: {
			providerId: { eq: providerId },
			status: { in: ["pending", "active"] },
		},
	});
	if (existing) {
		throw new HTTPException(409, {
			message:
				existing.status === "pending"
					? "A claim for this provider is already under review."
					: "This provider has already been claimed.",
		});
	}

	// Claims land as pending: a carrier only becomes operational once an
	// admin approves the claim in the review queue. The partial unique index
	// on live claims backstops the pre-check against concurrent claimers.
	let claim: ProviderClaimRow;
	try {
		[claim] = await db
			.insert(tables.providerClaim)
			.values({
				providerCompanyId,
				providerId,
				matchedDomain: match.matchedDomain,
				logoUrl: logoUrl ?? null,
				iconUrl: iconUrl ?? null,
				claimedBy: user.id,
			})
			.returning();
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new HTTPException(409, {
				message: "A claim for this provider is already under review.",
			});
		}
		throw err;
	}
	const providerNames = providerNamesById;
	return c.json({ claim: serializeClaim(claim, providerNames) }, 201);
});

// ---------------------------------------------------------------------------
// Custom carrier registration
// ---------------------------------------------------------------------------

// Carrier ids share a namespace with catalogue provider ids and the gateway's
// model-string prefixes, so reserve the prefixes the parser treats specially.
const RESERVED_CARRIER_IDS = new Set([
	"custom",
	"auto",
	"llmgateway",
	// "dynamic/<name>" invokes named dynamic routes in the gateway parser.
	"dynamic",
]);
const CARRIER_ID_PATTERN = /^[a-z][a-z0-9-]{2,31}$/;

const registerCarrier = createRoute({
	method: "post",
	path: "/carriers",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						providerId: z
							.string()
							.regex(
								CARRIER_ID_PATTERN,
								"Carrier id must be 3-32 chars: lowercase letters, digits and hyphens, starting with a letter.",
							),
						name: z.string().min(2).max(100),
						baseUrl: z.string().url().max(500),
						description: z.string().max(2000).optional(),
						logoUrl: imageDataUrl(LOGO_MAX_BYTES).optional(),
						iconUrl: imageDataUrl(ICON_MAX_BYTES).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ claim: claimSchema }),
				},
			},
			description: "The registration, filed as a pending custom-carrier claim.",
		},
	},
});

airside.openapi(registerCarrier, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const body = c.req.valid("json");
	await requireCompanyMembership(user.id, body.providerCompanyId);

	if (airsideListingFeeRequired()) {
		const company = await db.query.providerCompany.findFirst({
			where: { id: { eq: body.providerCompanyId } },
		});
		if (company?.paymentStatus !== "paid") {
			throw new HTTPException(402, {
				message: "Pay the listing fee before registering a carrier.",
			});
		}
	}

	const providerId = body.providerId;
	if (
		RESERVED_CARRIER_IDS.has(providerId) ||
		catalogueProviders.some((p) => p.id === providerId)
	) {
		throw new HTTPException(409, {
			message:
				"This carrier id is taken by an existing catalogue provider. Claim it instead if it is yours.",
		});
	}
	const providerRow = await db.query.provider.findFirst({
		where: { id: { eq: providerId } },
		columns: { id: true },
	});
	if (providerRow) {
		throw new HTTPException(409, { message: "This carrier id is taken." });
	}
	// Carrier ids share the request-prefix namespace with organizations' BYOK
	// custom providers. A collision would let the carrier silently capture
	// another tenant's "name/model" requests, so the namespaces stay disjoint
	// (the BYOK key routes enforce the mirror check).
	const byokCollision = await db.query.providerKey.findFirst({
		where: {
			provider: { eq: "custom" },
			name: { eq: providerId },
			status: { eq: "active" },
		},
		columns: { id: true },
	});
	if (byokCollision) {
		throw new HTTPException(409, { message: "This carrier id is taken." });
	}

	// The same anti-squatting rule as claiming: the registered endpoint must
	// live on a domain the registrant proved — their verified email's domain,
	// or one their company published our TXT token on. The SSRF guard keeps
	// the stored URL a safe outbound fetch target (https, public host).
	await assertSafeProviderUrl(body.baseUrl);
	const emailDomain = emailRegistrableDomain(user.email);
	const claimDomains = await userClaimDomains(user);
	if (claimDomains.size === 0) {
		throw new HTTPException(403, {
			message: isFreemailDomain(emailDomain)
				? "Personal email domains can't host a carrier API. Sign up with an address on your company's domain, or verify your company's domain over DNS, to register a carrier."
				: "Verify your email, or verify your company's domain over DNS, before registering a carrier.",
		});
	}
	const endpointDomain = registrableDomain(new URL(body.baseUrl).hostname);
	if (!claimDomains.has(endpointDomain)) {
		throw new HTTPException(403, {
			message: `The API endpoint must be on ${[...claimDomains]
				.map((d) => `@${d}`)
				.join(" or ")} — the domain you verified.`,
		});
	}
	const matchedDomain = endpointDomain;

	const existing = await db.query.providerClaim.findFirst({
		where: {
			providerId: { eq: providerId },
			status: { in: ["pending", "active"] },
		},
	});
	if (existing) {
		throw new HTTPException(409, {
			message:
				existing.status === "pending"
					? "A registration for this carrier id is already under review."
					: "This carrier id is taken.",
		});
	}

	let claim: ProviderClaimRow;
	try {
		[claim] = await db
			.insert(tables.providerClaim)
			.values({
				providerCompanyId: body.providerCompanyId,
				providerId,
				kind: "custom",
				matchedDomain,
				customName: body.name,
				customBaseUrl: body.baseUrl,
				customDescription: body.description ?? null,
				logoUrl: body.logoUrl ?? null,
				iconUrl: body.iconUrl ?? null,
				claimedBy: user.id,
			})
			.returning();
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new HTTPException(409, { message: "This carrier id is taken." });
		}
		throw err;
	}
	return c.json({ claim: serializeClaim(claim, providerNamesById) }, 201);
});

// Branding is the only carrier-editable part of a claim after filing: the
// identity fields (provider id, display name, website, API endpoint) are what
// the review approved, so changing them takes a new registration.
const updateClaimBranding = createRoute({
	method: "patch",
	path: "/claims/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// null clears the image; omitted keeps the current one.
						logoUrl: imageDataUrl(LOGO_MAX_BYTES).nullish(),
						iconUrl: imageDataUrl(ICON_MAX_BYTES).nullish(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ claim: claimSchema }),
				},
			},
			description: "The claim with its updated branding.",
		},
	},
});

airside.openapi(updateClaimBranding, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	await requireCompanyMembership(user.id, claim.providerCompanyId);
	if (claim.status !== "pending" && claim.status !== "active") {
		throw new HTTPException(409, {
			message: "Only pending or active claims can change their branding.",
		});
	}
	const brandingUpdates = {
		...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl } : {}),
		...(body.iconUrl !== undefined ? { iconUrl: body.iconUrl } : {}),
	};
	// An empty diff is a no-op, not a drizzle "No values to set" 500.
	if (Object.keys(brandingUpdates).length === 0) {
		return c.json({ claim: serializeClaim(claim, providerNamesById) });
	}
	// cdb: claim rows feed the gateway's custom-carrier resolution cache.
	const [updated] = await cdb
		.update(tables.providerClaim)
		.set(brandingUpdates)
		.where(eq(tables.providerClaim.id, id))
		.returning();
	if (!updated) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	return c.json({ claim: serializeClaim(updated, providerNamesById) });
});

// ---------------------------------------------------------------------------
// Models (fleet)
// ---------------------------------------------------------------------------

const listModels = createRoute({
	method: "get",
	path: "/models",
	request: {
		query: z.object({
			providerCompanyId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ models: z.array(modelSchema) }),
				},
			},
			description: "The company's listed models with pricing state.",
		},
	},
});

airside.openapi(listModels, async (c) => {
	const user = requireUser(c.get("user"));
	const { providerCompanyId } = c.req.valid("query");
	await requireCompanyMembership(user.id, providerCompanyId);
	const rows = await db.query.providerDraftModel.findMany({
		where: { providerCompanyId: { eq: providerCompanyId } },
		with: { priceFilings: true },
		orderBy: { createdAt: "desc" },
	});
	return c.json({ models: rows.map(serializeModel) });
});

const createModel = createRoute({
	method: "post",
	path: "/models",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						providerId: z.string(),
						modelName: z.string().min(1).max(200),
						displayName: z.string().max(200).optional(),
						description: z.string().max(2000).optional(),
						family: z.string().max(100).optional(),
						contextSize: z.number().int().positive().optional(),
						maxOutput: z.number().int().positive().optional(),
						streaming: z.boolean().optional(),
						vision: z.boolean().optional(),
						audio: z.boolean().optional(),
						tools: z.boolean().optional(),
						jsonOutput: z.boolean().optional(),
						reasoning: z.boolean().optional(),
						reasoningEfforts: reasoningEffortsValue.nullish(),
						maxRpm: z.number().int().positive().optional(),
						maxRpd: z.number().int().positive().optional(),
						rateLimitScope: z.enum(["global", "per_org"]).optional(),
						pricing: pricingSchema,
						note: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ model: modelSchema }),
				},
			},
			description:
				"The drafted model. It activates once its initial price filing is approved.",
		},
	},
});

airside.openapi(createModel, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const body = c.req.valid("json");
	await requireCompanyMembership(user.id, body.providerCompanyId);

	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: body.providerCompanyId },
			providerId: { eq: body.providerId },
			status: { in: ["pending", "active"] },
		},
	});
	if (!claim) {
		throw new HTTPException(403, {
			message: "This provider is not claimed by the company.",
		});
	}
	if (claim.status !== "active") {
		throw new HTTPException(403, {
			message:
				"This carrier claim is still under review — models can be listed once it is approved.",
		});
	}

	if (staticCatalogueHasActiveMapping(body.providerId, body.modelName)) {
		throw new HTTPException(409, {
			message:
				"This model is already in the LLM Gateway catalogue for the provider — import your catalogue models instead of re-listing them.",
		});
	}

	const duplicate = await db.query.providerDraftModel.findFirst({
		where: {
			providerId: { eq: body.providerId },
			modelName: { eq: body.modelName },
			status: { ne: "delisted" },
		},
	});
	if (duplicate) {
		throw new HTTPException(409, {
			message: "A model with this name is already listed for the provider.",
		});
	}

	// cdb: the gateway caches airside model lookups; writes must invalidate.
	const created = await cdb
		.transaction(async (tx) => {
			const [model] = await tx
				.insert(tables.providerDraftModel)
				.values({
					providerCompanyId: body.providerCompanyId,
					providerId: body.providerId,
					modelName: body.modelName,
					displayName: body.displayName ?? null,
					description: body.description ?? null,
					family: body.family ?? null,
					contextSize: body.contextSize ?? null,
					maxOutput: body.maxOutput ?? null,
					streaming: body.streaming ?? true,
					vision: body.vision ?? false,
					audio: body.audio ?? false,
					tools: body.tools ?? false,
					jsonOutput: body.jsonOutput ?? false,
					reasoning: body.reasoning ?? false,
					reasoningEfforts: body.reasoningEfforts ?? null,
					maxRpm: body.maxRpm ?? null,
					maxRpd: body.maxRpd ?? null,
					rateLimitScope: body.rateLimitScope ?? "global",
					createdBy: user.id,
				})
				.returning();
			const [filing] = await tx
				.insert(tables.providerPriceFiling)
				.values({
					draftModelId: model.id,
					providerCompanyId: body.providerCompanyId,
					kind: "initial",
					inputPrice: body.pricing.inputPrice,
					outputPrice: body.pricing.outputPrice,
					cachedInputPrice: body.pricing.cachedInputPrice ?? null,
					requestPrice: body.pricing.requestPrice ?? null,
					requestedBy: user.id,
					note: body.note ?? null,
				})
				.returning();
			return { ...model, priceFilings: [filing] };
		})
		.catch((err: unknown) => {
			// The partial unique index on live (provider, model) rows backstops
			// the pre-check against a concurrent create.
			if (isUniqueViolation(err)) {
				throw new HTTPException(409, {
					message: "A model with this name is already listed for the provider.",
				});
			}
			throw err;
		});

	return c.json({ model: serializeModel(created) }, 201);
});

// ---------------------------------------------------------------------------
// Catalogue → DB migration: a claimed carrier imports its static-catalogue
// models as Airside listings (active, with the current prices as an approved
// filing). Routing still prefers the static mapping; once we deactivate it in
// packages/models, the imported listing takes over — that is the migration.
// ---------------------------------------------------------------------------

const importCatalogueModels = createRoute({
	method: "post",
	path: "/models/import",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						providerId: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						// Canonical model ids now managed in Airside.
						imported: z.array(z.string()),
						// Already listed, or unpriceable (tiered/priceless mappings).
						skipped: z.array(z.string()),
					}),
				},
			},
			description:
				"Imports the carrier's active catalogue models as managed listings.",
		},
	},
});

airside.openapi(importCatalogueModels, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const body = c.req.valid("json");
	await requireCompanyMembership(user.id, body.providerCompanyId);
	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: body.providerCompanyId },
			providerId: { eq: body.providerId },
			status: { eq: "active" },
		},
	});
	if (!claim) {
		throw new HTTPException(403, {
			message: "Only an active carrier can import its catalogue models.",
		});
	}
	if (claim.kind !== "catalogue") {
		throw new HTTPException(400, {
			message: "Custom carriers have no catalogue models to import.",
		});
	}

	const now = new Date();
	const existing = await db.query.providerDraftModel.findMany({
		where: {
			providerId: { eq: body.providerId },
			status: { ne: "delisted" },
		},
		columns: { modelName: true },
	});
	const listed = new Set(existing.map((m) => m.modelName));
	const imported: string[] = [];
	const skipped: string[] = [];

	for (const model of catalogueModels) {
		const found = model.providers.find((p) => {
			if (p.providerId !== body.providerId) {
				return false;
			}
			const deactivatedAt =
				"deactivatedAt" in p
					? (p.deactivatedAt as Date | string | undefined)
					: undefined;
			return !(deactivatedAt && new Date(deactivatedAt) <= now);
		});
		if (!found) {
			continue;
		}
		// The literal-typed catalogue entries narrow away optional fields;
		// the interface view restores them.
		const mapping = found as ProviderModelMapping;
		// A listing carries one flat price pair. A catalogue mapping with
		// context-length bands or per-region rates cannot be represented by
		// one, and importing it anyway would bill every request outside the
		// base band at the wrong rate — so those stay on the catalogue.
		if (
			listed.has(model.id) ||
			!mapping.inputPrice ||
			!mapping.outputPrice ||
			(mapping.pricingTiers?.length ?? 0) > 0 ||
			(mapping.regions?.length ?? 0) > 0
		) {
			skipped.push(model.id);
			continue;
		}
		// cdb: the gateway caches these tables for listing resolution.
		await cdb.transaction(async (tx) => {
			const [row] = await tx
				.insert(tables.providerDraftModel)
				.values({
					providerCompanyId: body.providerCompanyId,
					providerId: body.providerId,
					modelName: model.id,
					displayName: model.name ?? null,
					family: model.family,
					contextSize: mapping.contextSize ?? null,
					maxOutput: mapping.maxOutput ?? null,
					// "only" means streaming-only upstream; either way it streams.
					streaming: mapping.streaming !== false,
					vision: mapping.vision ?? false,
					audio: Boolean(mapping.audio),
					tools: mapping.tools ?? false,
					jsonOutput: mapping.jsonOutput ?? false,
					reasoning: mapping.reasoning ?? false,
					reasoningEfforts: mapping.reasoningEfforts ?? null,
					status: "active",
					createdBy: user.id,
				})
				.returning();
			await tx.insert(tables.providerPriceFiling).values({
				draftModelId: row.id,
				providerCompanyId: body.providerCompanyId,
				kind: "initial",
				inputPrice: String(mapping.inputPrice),
				outputPrice: String(mapping.outputPrice),
				cachedInputPrice: mapping.cachedInputPrice
					? String(mapping.cachedInputPrice)
					: null,
				requestPrice: mapping.requestPrice
					? String(mapping.requestPrice)
					: null,
				requestedBy: user.id,
				status: "approved",
				reviewNote: "Imported from the catalogue",
				reviewedAt: new Date(),
			});
		});
		imported.push(model.id);
	}

	return c.json({ imported, skipped });
});

const updateModel = createRoute({
	method: "patch",
	path: "/models/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						displayName: z.string().max(200).nullish(),
						description: z.string().max(2000).nullish(),
						family: z.string().max(100).nullish(),
						contextSize: z.number().int().positive().nullish(),
						maxOutput: z.number().int().positive().nullish(),
						streaming: z.boolean().optional(),
						vision: z.boolean().optional(),
						audio: z.boolean().optional(),
						tools: z.boolean().optional(),
						jsonOutput: z.boolean().optional(),
						reasoning: z.boolean().optional(),
						reasoningEfforts: reasoningEffortsValue.nullish(),
						maxRpm: z.number().int().positive().nullish(),
						maxRpd: z.number().int().positive().nullish(),
						rateLimitScope: z.enum(["global", "per_org"]).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ model: modelSchema }),
				},
			},
			description:
				"The updated model. Pricing is not editable here — file a price change instead.",
		},
	},
});

airside.openapi(updateModel, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: id } },
	});
	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	await requireCompanyMembership(user.id, model.providerCompanyId);
	if (model.status === "delisted") {
		throw new HTTPException(409, {
			message: "Delisted models cannot be edited.",
		});
	}
	const updates = {
		...(body.displayName !== undefined
			? { displayName: body.displayName }
			: {}),
		...(body.description !== undefined
			? { description: body.description }
			: {}),
		...(body.family !== undefined ? { family: body.family } : {}),
		...(body.contextSize !== undefined
			? { contextSize: body.contextSize }
			: {}),
		...(body.maxOutput !== undefined ? { maxOutput: body.maxOutput } : {}),
		...(body.streaming !== undefined ? { streaming: body.streaming } : {}),
		...(body.vision !== undefined ? { vision: body.vision } : {}),
		...(body.audio !== undefined ? { audio: body.audio } : {}),
		...(body.tools !== undefined ? { tools: body.tools } : {}),
		...(body.jsonOutput !== undefined ? { jsonOutput: body.jsonOutput } : {}),
		...(body.reasoning !== undefined ? { reasoning: body.reasoning } : {}),
		...(body.reasoningEfforts !== undefined
			? { reasoningEfforts: body.reasoningEfforts }
			: {}),
		...(body.maxRpm !== undefined ? { maxRpm: body.maxRpm } : {}),
		...(body.maxRpd !== undefined ? { maxRpd: body.maxRpd } : {}),
		...(body.rateLimitScope !== undefined
			? { rateLimitScope: body.rateLimitScope }
			: {}),
	};
	// An empty diff is a no-op, not a drizzle "No values to set" 500.
	if (Object.keys(updates).length === 0) {
		const unchangedFilings = await db.query.providerPriceFiling.findMany({
			where: { draftModelId: { eq: id } },
		});
		return c.json({
			model: serializeModel({ ...model, priceFilings: unchangedFilings }),
		});
	}
	const [updated] = await cdb
		.update(tables.providerDraftModel)
		.set(updates)
		.where(eq(tables.providerDraftModel.id, id))
		.returning();
	if (!updated) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	// Active listings mirror non-pricing edits straight into the catalogue.
	await syncAirsideModelMetadata(updated);
	const filings = await db.query.providerPriceFiling.findMany({
		where: { draftModelId: { eq: id } },
	});
	return c.json({
		model: serializeModel({ ...updated, priceFilings: filings }),
	});
});

const deleteModel = createRoute({
	method: "delete",
	path: "/models/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.enum(["deleted", "delisted"]),
					}),
				},
			},
			description:
				"Drafts are removed outright; active models are delisted instead.",
		},
	},
});

airside.openapi(deleteModel, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: id } },
	});
	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	await requireCompanyMembership(user.id, model.providerCompanyId);
	if (model.status === "draft" || model.status === "rejected") {
		await cdb
			.delete(tables.providerDraftModel)
			.where(eq(tables.providerDraftModel.id, id));
		return c.json({ status: "deleted" as const });
	}
	await cdb
		.update(tables.providerDraftModel)
		.set({ status: "delisted", delistedAt: new Date() })
		.where(eq(tables.providerDraftModel.id, id));
	// A delisted model's pending filing would otherwise linger in the admin
	// queue and approve as a silent no-op.
	await db
		.update(tables.providerPriceFiling)
		.set({
			status: "rejected",
			reviewNote: "Model delisted",
			reviewedAt: new Date(),
		})
		.where(
			and(
				eq(tables.providerPriceFiling.draftModelId, id),
				eq(tables.providerPriceFiling.status, "pending"),
			),
		);
	await dematerializeAirsideModel(model.providerId, model.modelName);
	return c.json({ status: "delisted" as const });
});

const createPriceFiling = createRoute({
	method: "post",
	path: "/models/{id}/price-filings",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: pricingSchema.extend({
						note: z.string().max(1000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ filing: filingSchema }),
				},
			},
			description: "The pending price filing awaiting admin approval.",
		},
	},
});

airside.openapi(createPriceFiling, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const model = await db.query.providerDraftModel.findFirst({
		where: { id: { eq: id } },
	});
	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}
	await requireCompanyMembership(user.id, model.providerCompanyId);
	if (model.status === "delisted") {
		throw new HTTPException(409, {
			message: "Delisted models cannot receive price filings.",
		});
	}
	const pending = await db.query.providerPriceFiling.findFirst({
		where: { draftModelId: { eq: id }, status: { eq: "pending" } },
	});
	if (pending) {
		throw new HTTPException(409, {
			message: "A price filing for this model is already pending review.",
		});
	}
	const kind = model.status === "active" ? "update" : "initial";
	const filing = await cdb.transaction(async (tx) => {
		if (model.status === "rejected") {
			await tx
				.update(tables.providerDraftModel)
				.set({ status: "draft" })
				.where(eq(tables.providerDraftModel.id, id));
		}
		const [created] = await tx
			.insert(tables.providerPriceFiling)
			.values({
				draftModelId: id,
				providerCompanyId: model.providerCompanyId,
				kind,
				inputPrice: body.inputPrice,
				outputPrice: body.outputPrice,
				cachedInputPrice: body.cachedInputPrice ?? null,
				requestPrice: body.requestPrice ?? null,
				requestedBy: user.id,
				note: body.note ?? null,
			})
			.returning();
		return created;
	});
	return c.json({ filing: serializeFiling(filing) }, 201);
});

const listFilings = createRoute({
	method: "get",
	path: "/filings",
	request: {
		query: z.object({
			providerCompanyId: z.string(),
			status: z.enum(["pending", "approved", "rejected"]).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						filings: z.array(
							filingSchema.extend({
								modelName: z.string(),
								providerId: z.string(),
							}),
						),
						routingFilings: z.array(routingFilingSchema),
					}),
				},
			},
			description:
				"Price and fare-change filings for the company, newest first.",
		},
	},
});

airside.openapi(listFilings, async (c) => {
	const user = requireUser(c.get("user"));
	const { providerCompanyId, status } = c.req.valid("query");
	await requireCompanyMembership(user.id, providerCompanyId);
	const [rows, routingRows] = await Promise.all([
		db.query.providerPriceFiling.findMany({
			where: {
				providerCompanyId: { eq: providerCompanyId },
				...(status ? { status: { eq: status } } : {}),
			},
			with: { draftModel: true },
			orderBy: { createdAt: "desc" },
			limit: 100,
		}),
		db.query.providerRoutingFiling.findMany({
			where: {
				providerCompanyId: { eq: providerCompanyId },
				...(status ? { status: { eq: status } } : {}),
			},
			orderBy: { createdAt: "desc" },
			limit: 100,
		}),
	]);
	return c.json({
		filings: rows.flatMap((row) =>
			row.draftModel
				? [
						{
							...serializeFiling(row),
							modelName: row.draftModel.modelName,
							providerId: row.draftModel.providerId,
						},
					]
				: [],
		),
		routingFilings: routingRows.map(serializeRoutingFiling),
	});
});

// ---------------------------------------------------------------------------
// Stats (traffic)
// ---------------------------------------------------------------------------

const statsRoute = createRoute({
	method: "get",
	path: "/stats",
	request: {
		query: z.object({
			providerCompanyId: z.string(),
			providerId: z.string().optional(),
			days: z.coerce.number().min(1).max(90).default(30).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						days: z.number(),
						providerIds: z.array(z.string()),
						totals: z.object({
							requestCount: z.number(),
							errorCount: z.number(),
							cacheCount: z.number(),
							inputTokens: z.number(),
							outputTokens: z.number(),
							totalTokens: z.number(),
							cost: z.number(),
						}),
						byModel: z.array(
							z.object({
								providerId: z.string(),
								model: z.string(),
								requestCount: z.number(),
								errorCount: z.number(),
								inputTokens: z.number(),
								outputTokens: z.number(),
								cost: z.number(),
							}),
						),
						daily: z.array(
							z.object({
								day: z.string(),
								requestCount: z.number(),
								errorCount: z.number(),
								outputTokens: z.number(),
								cost: z.number(),
							}),
						),
					}),
				},
			},
			description:
				"Usage of the company's claimed providers, aggregated from hourly rollups.",
		},
	},
});

airside.openapi(statsRoute, async (c) => {
	const user = requireUser(c.get("user"));
	const query = c.req.valid("query");
	const days = query.days ?? 30;
	await requireCompanyMembership(user.id, query.providerCompanyId);
	let providerIds = await getActiveClaimedProviderIds(query.providerCompanyId);
	if (query.providerId) {
		providerIds = providerIds.filter((p) => p === query.providerId);
	}

	const emptyTotals = {
		requestCount: 0,
		errorCount: 0,
		cacheCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cost: 0,
	};
	if (providerIds.length === 0) {
		return c.json({
			days,
			providerIds,
			totals: emptyTotals,
			byModel: [],
			daily: [],
		});
	}

	const mph = tables.projectHourlyModelStats;
	const windowMs = days * 86_400_000;
	const since = new Date(Date.now() - windowMs);
	since.setMinutes(0, 0, 0);
	const whereClause = and(
		inArray(mph.usedProvider, providerIds),
		gte(mph.hourTimestamp, since),
	);

	const [totalsRow] = await db
		.select({
			requestCount: sql<number>`COALESCE(SUM(${mph.requestCount}), 0)::int`,
			errorCount: sql<number>`COALESCE(SUM(${mph.errorCount}), 0)::int`,
			cacheCount: sql<number>`COALESCE(SUM(${mph.cacheCount}), 0)::int`,
			inputTokens: sql<number>`COALESCE(SUM(${mph.inputTokens}), 0)::float8`,
			outputTokens: sql<number>`COALESCE(SUM(${mph.outputTokens}), 0)::float8`,
			totalTokens: sql<number>`COALESCE(SUM(${mph.totalTokens}), 0)::float8`,
			cost: sql<number>`COALESCE(SUM(${mph.cost}), 0)::float8`,
		})
		.from(mph)
		.where(whereClause);

	const byModelRows = await db
		.select({
			providerId: mph.usedProvider,
			model: mph.usedModel,
			requestCount: sql<number>`SUM(${mph.requestCount})::int`,
			errorCount: sql<number>`SUM(${mph.errorCount})::int`,
			inputTokens: sql<number>`SUM(${mph.inputTokens})::float8`,
			outputTokens: sql<number>`SUM(${mph.outputTokens})::float8`,
			cost: sql<number>`SUM(${mph.cost})::float8`,
		})
		.from(mph)
		.where(whereClause)
		.groupBy(mph.usedProvider, mph.usedModel)
		.orderBy(desc(sql`SUM(${mph.cost})`));

	const dayExpr = sql<string>`date_trunc('day', ${mph.hourTimestamp})`;
	const dailyRows = await db
		.select({
			day: dayExpr,
			requestCount: sql<number>`SUM(${mph.requestCount})::int`,
			errorCount: sql<number>`SUM(${mph.errorCount})::int`,
			outputTokens: sql<number>`SUM(${mph.outputTokens})::float8`,
			cost: sql<number>`SUM(${mph.cost})::float8`,
		})
		.from(mph)
		.where(whereClause)
		.groupBy(dayExpr)
		.orderBy(dayExpr);

	return c.json({
		days,
		providerIds,
		totals: totalsRow
			? {
					requestCount: totalsRow.requestCount,
					errorCount: totalsRow.errorCount,
					cacheCount: totalsRow.cacheCount,
					inputTokens: totalsRow.inputTokens,
					outputTokens: totalsRow.outputTokens,
					totalTokens: totalsRow.totalTokens,
					cost: totalsRow.cost,
				}
			: emptyTotals,
		// The gateway logs used_model as "provider/model"; seeded rollups use
		// bare names. Normalize for display.
		byModel: byModelRows.map((row) => ({
			...row,
			model: row.model.startsWith(`${row.providerId}/`)
				? row.model.slice(row.providerId.length + 1)
				: row.model,
		})),
		daily: dailyRows.map((row) => ({
			...row,
			day: new Date(row.day).toISOString(),
		})),
	});
});

// ---------------------------------------------------------------------------
// Routing settings (fares & landing fees)
// ---------------------------------------------------------------------------

const listRoutingSettings = createRoute({
	method: "get",
	path: "/routing-settings",
	request: {
		query: z.object({ providerCompanyId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						baselineMargin: z.number(),
						settings: z.array(routingSettingsSchema),
					}),
				},
			},
			description: "Routing knobs for each claimed provider.",
		},
	},
});

airside.openapi(listRoutingSettings, async (c) => {
	const user = requireUser(c.get("user"));
	const { providerCompanyId } = c.req.valid("query");
	await requireCompanyMembership(user.id, providerCompanyId);
	const providerIds = await getActiveClaimedProviderIds(providerCompanyId);
	const [rows, pendingFilings] = providerIds.length
		? await Promise.all([
				db.query.providerRoutingSettings.findMany({
					where: { providerId: { in: providerIds } },
				}),
				db.query.providerRoutingFiling.findMany({
					where: {
						providerId: { in: providerIds },
						status: { eq: "pending" },
					},
				}),
			])
		: [[], []];
	const rowByProvider = new Map(rows.map((row) => [row.providerId, row]));
	const pendingByProvider = new Map(
		pendingFilings.map((filing) => [filing.providerId, filing]),
	);
	return c.json({
		baselineMargin: AIRSIDE_BASELINE_MARGIN,
		settings: providerIds.map((providerId) => {
			const row = rowByProvider.get(providerId);
			const pending = pendingByProvider.get(providerId);
			const discountPercent = row ? Number(row.discountPercent) : 0;
			const marginPercent = row
				? Number(row.marginPercent)
				: AIRSIDE_BASELINE_MARGIN;
			return {
				providerId,
				providerCompanyId,
				discountPercent,
				marginPercent,
				routingAdjustment: computeAirsideAdjustment(
					discountPercent,
					marginPercent,
				),
				updatedAt: row ? row.updatedAt.toISOString() : null,
				pendingFiling: pending ? serializeRoutingFiling(pending) : null,
			};
		}),
	});
});

const updateRoutingSettings = createRoute({
	method: "put",
	path: "/routing-settings/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						providerCompanyId: z.string(),
						discountPercent: z.number().min(0).max(AIRSIDE_DISCOUNT_MAX),
						marginPercent: z
							.number()
							.min(AIRSIDE_MARGIN_MIN)
							.max(AIRSIDE_MARGIN_MAX),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ filing: routingFilingSchema }),
				},
			},
			description:
				"The fare-change filing. Routing settings only change once an admin approves it.",
		},
	},
});

airside.openapi(updateRoutingSettings, async (c) => {
	const user = requireVerifiedUser(c.get("user"));
	const { providerId } = c.req.valid("param");
	const body = c.req.valid("json");
	await requireCompanyMembership(user.id, body.providerCompanyId);

	const claim = await db.query.providerClaim.findFirst({
		where: {
			providerCompanyId: { eq: body.providerCompanyId },
			providerId: { eq: providerId },
			status: { eq: "active" },
		},
	});
	if (!claim) {
		throw new HTTPException(403, {
			message: "This provider is not claimed by the company.",
		});
	}

	const existing = await db.query.providerRoutingSettings.findFirst({
		where: { providerId: { eq: providerId } },
	});
	const currentDiscount = existing ? Number(existing.discountPercent) : 0;
	const currentMargin = existing
		? Number(existing.marginPercent)
		: AIRSIDE_BASELINE_MARGIN;
	if (
		body.discountPercent === currentDiscount &&
		body.marginPercent === currentMargin
	) {
		throw new HTTPException(400, {
			message: "These are already your live fares.",
		});
	}
	// Fare changes are filings: nothing reaches the routing election until an
	// admin approves them, so a carrier cannot move its knobs invisibly.
	try {
		const [filing] = await db
			.insert(tables.providerRoutingFiling)
			.values({
				providerCompanyId: body.providerCompanyId,
				providerId,
				discountPercent: String(body.discountPercent),
				marginPercent: String(body.marginPercent),
				requestedBy: user.id,
			})
			.returning();
		return c.json({ filing: serializeRoutingFiling(filing) }, 201);
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new HTTPException(409, {
				message: "A fare change for this carrier is already awaiting approval.",
			});
		}
		throw err;
	}
});
