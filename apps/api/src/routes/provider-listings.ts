import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getClientIpFromContext } from "@/lib/client-ip.js";
import { assertProviderBaseUrlAllowed } from "@/routes/keys-provider.js";
import { getStripe } from "@/routes/payments.js";
import { ensureStripeCustomer } from "@/stripe.js";
import { notifyProviderContact } from "@/utils/discord.js";

import {
	encryptProviderKey,
	getRequiredChecksForModel,
} from "@llmgateway/actions";
import {
	and,
	db,
	eq,
	isNull,
	shortid,
	tables,
	type ProviderListingClaimedModel,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	models,
	providers,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { ServerTypes } from "@/vars.js";

export const providerListings = new OpenAPIHono<ServerTypes>();

const MAX_CLAIMED_MODELS = 10;
const MIN_DISCOUNT = 0.01;
const MAX_DISCOUNT = 0.5;

const claimedModelSchema = z.object({
	modelId: z.string().min(1),
	externalId: z.string().min(1),
});

const listingStateSchema = z.enum([
	"awaiting_payment",
	"validation_required",
	"validation_in_progress",
	"validation_failed",
	"ready_to_activate",
	"live",
	"archived",
	"rejected",
]);

const listingSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	providerName: z.string(),
	providerSlug: z.string().nullable(),
	url: z.string(),
	termsUrl: z.string().nullable(),
	privacyUrl: z.string().nullable(),
	statusPageUrl: z.string().nullable(),
	country: z.string(),
	complianceSoc2Type2: z.boolean(),
	complianceIso27001: z.boolean(),
	complianceGdpr: z.boolean(),
	dataRetentionDays: z.number().nullable(),
	trainsOnData: z.boolean().nullable(),
	paymentStatus: z.enum(["unpaid", "paid", "refunded"]),
	paidAt: z.string().nullable(),
	baseUrl: z.string().nullable(),
	testKeyMasked: z.string().nullable(),
	claimedModels: z.array(claimedModelSchema).nullable(),
	discountPercent: z.string().nullable(),
	validationStatus: z.enum([
		"not_started",
		"queued",
		"running",
		"passed",
		"failed",
	]),
	listedAt: z.string().nullable(),
	archivedAt: z.string().nullable(),
	state: listingStateSchema,
});

const checkResultSchema = z.object({
	modelId: z.string(),
	externalId: z.string(),
	check: z.enum(["chat", "streaming", "json_mode", "tool_calls"]),
	passed: z.boolean(),
	required: z.boolean(),
	latencyMs: z.number().optional(),
	error: z.string().optional(),
});

const testRunSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	status: z.enum(["queued", "running", "passed", "failed"]),
	startedAt: z.string().nullable(),
	completedAt: z.string().nullable(),
	results: z.array(checkResultSchema),
	error: z.string().nullable(),
});

type ListingRow = typeof tables.providerListingRequest.$inferSelect;
type TestRunRow = typeof tables.providerListingTestRun.$inferSelect;

function deriveState(row: ListingRow): z.infer<typeof listingStateSchema> {
	if (row.spamFilterStatus === "rejected") {
		return "rejected";
	}
	if (row.archivedAt) {
		return "archived";
	}
	if (row.listedAt) {
		return "live";
	}
	if (row.paymentStatus === "unpaid") {
		return "awaiting_payment";
	}
	if (row.validationStatus === "queued" || row.validationStatus === "running") {
		return "validation_in_progress";
	}
	if (row.validationStatus === "failed") {
		return "validation_failed";
	}
	if (row.validationStatus === "passed") {
		return "ready_to_activate";
	}
	return "validation_required";
}

function serializeListing(row: ListingRow): z.infer<typeof listingSchema> {
	return {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		providerName: row.providerName,
		providerSlug: row.providerSlug,
		url: row.url,
		termsUrl: row.termsUrl,
		privacyUrl: row.privacyUrl,
		statusPageUrl: row.statusPageUrl,
		country: row.country,
		complianceSoc2Type2: row.complianceSoc2Type2,
		complianceIso27001: row.complianceIso27001,
		complianceGdpr: row.complianceGdpr,
		dataRetentionDays: row.dataRetentionDays,
		trainsOnData: row.trainsOnData,
		paymentStatus: row.paymentStatus,
		paidAt: row.paidAt?.toISOString() ?? null,
		baseUrl: row.baseUrl,
		testKeyMasked: row.testKeyMasked,
		claimedModels: row.claimedModels,
		discountPercent: row.discountPercent,
		validationStatus: row.validationStatus,
		listedAt: row.listedAt?.toISOString() ?? null,
		archivedAt: row.archivedAt?.toISOString() ?? null,
		state: deriveState(row),
	};
}

function serializeTestRun(row: TestRunRow): z.infer<typeof testRunSchema> {
	return {
		id: row.id,
		createdAt: row.createdAt.toISOString(),
		status: row.status,
		startedAt: row.startedAt?.toISOString() ?? null,
		completedAt: row.completedAt?.toISOString() ?? null,
		results: row.results,
		error: row.error,
	};
}

async function requireOrgAdmin(userId: string, organizationId: string) {
	const userOrg = await db.query.userOrganization.findFirst({
		where: { userId, organizationId },
		with: { organization: true },
	});
	if (!userOrg || !userOrg.organization) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage provider listings",
		});
	}
	return userOrg.organization;
}

async function requireListing(userId: string, listingId: string) {
	const listing = await db.query.providerListingRequest.findFirst({
		where: { id: listingId },
	});
	if (!listing || !listing.organizationId) {
		throw new HTTPException(404, { message: "Provider listing not found" });
	}
	await requireOrgAdmin(userId, listing.organizationId);
	return listing;
}

function slugifyProviderName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Claimed models must exist in the catalogue and be chat-capable somewhere,
 * because the validation suite probes chat completions and the eventual
 * catalogue mapping inherits the model's capability expectations.
 */
function assertClaimedModelsValid(claimed: ProviderListingClaimedModel[]) {
	const seen = new Set<string>();
	for (const entry of claimed) {
		if (seen.has(entry.modelId)) {
			throw new HTTPException(400, {
				message: `Model ${entry.modelId} is claimed more than once`,
			});
		}
		seen.add(entry.modelId);
		const modelDef = models.find((m) => m.id === entry.modelId);
		if (!modelDef) {
			throw new HTTPException(400, {
				message: `Unknown model id: ${entry.modelId}`,
			});
		}
		const chatCapable = (
			modelDef.providers as readonly ProviderModelMapping[]
		).some(
			(p) =>
				!(
					p.imageGenerations ||
					p.videoGenerations ||
					p.embeddings ||
					p.speechGenerations ||
					p.transcriptions ||
					p.ocr
				),
		);
		if (!chatCapable) {
			throw new HTTPException(400, {
				message: `Model ${entry.modelId} is not a chat model and cannot be validated`,
			});
		}
	}
}

async function createListingCheckoutSession(listing: {
	id: string;
	providerName: string;
	organizationId: string;
}): Promise<string | null> {
	const providerListingPriceId = process.env.STRIPE_PROVIDER_LISTING_PRICE_ID;
	if (!providerListingPriceId) {
		logger.warn(
			"STRIPE_PROVIDER_LISTING_PRICE_ID not configured; skipping provider listing checkout",
		);
		return null;
	}
	try {
		const stripeCustomerId = await ensureStripeCustomer(listing.organizationId);
		const uiUrl = process.env.UI_URL ?? "http://localhost:3002";
		const returnBase = `${uiUrl}/dashboard/${listing.organizationId}/org/provider-listing`;
		const checkoutSession = await getStripe().checkout.sessions.create({
			mode: "payment",
			customer: stripeCustomerId,
			line_items: [{ price: providerListingPriceId, quantity: 1 }],
			success_url: `${returnBase}?payment=success`,
			cancel_url: `${returnBase}?payment=canceled`,
			metadata: {
				type: "provider_listing",
				submissionId: listing.id,
				providerName: listing.providerName,
			},
			payment_intent_data: {
				metadata: {
					type: "provider_listing",
					submissionId: listing.id,
				},
			},
		});
		return checkoutSession.url;
	} catch (err) {
		logger.error(
			"Failed to create provider listing checkout session",
			err instanceof Error ? err : new Error(String(err)),
		);
		return null;
	}
}

async function findBoostRow(providerSlug: string) {
	return await db.query.routingScoreMultiplier.findFirst({
		where: { provider: providerSlug, model: { isNull: true } },
	});
}

/**
 * Provision (or refresh) the routing boost for a live listing: the provider's
 * committed discount becomes a negative routing-score multiplier, so the
 * router prices them at (1 - discount) x list when electing a provider. The
 * row is keyed on the listing's provider slug and takes effect as soon as a
 * catalogue provider with that id exists.
 */
async function upsertRoutingBoost(listing: ListingRow, discount: number) {
	const reason = `Self-serve provider listing ${listing.id} (${listing.providerName}): ${Math.round(discount * 100)}% discount commitment`;
	const existing = await findBoostRow(listing.providerSlug!);
	if (existing) {
		await db
			.update(tables.routingScoreMultiplier)
			.set({ scoreMultiplier: (-discount).toString(), reason })
			.where(eq(tables.routingScoreMultiplier.id, existing.id));
	} else {
		await db.insert(tables.routingScoreMultiplier).values({
			provider: listing.providerSlug!,
			model: null,
			scoreMultiplier: (-discount).toString(),
			reason,
		});
	}
}

async function removeRoutingBoost(providerSlug: string) {
	await db
		.delete(tables.routingScoreMultiplier)
		.where(
			and(
				eq(tables.routingScoreMultiplier.provider, providerSlug),
				isNull(tables.routingScoreMultiplier.model),
			),
		);
}

const createListingSchema = z.object({
	organizationId: z.string().min(1),
	providerName: z.string().min(2).max(100),
	url: z.string().url(),
	termsUrl: z.string().url(),
	privacyUrl: z.string().url(),
	statusPageUrl: z.string().url().optional(),
	country: z.string().min(1),
	complianceSoc2Type2: z.boolean().optional().default(false),
	complianceIso27001: z.boolean().optional().default(false),
	complianceGdpr: z.boolean().optional().default(false),
	dataRetentionDays: z.number().int().min(0),
	trainsOnData: z.boolean(),
	baseUrl: z.string().url(),
	testApiKey: z.string().min(8),
	claimedModels: z.array(claimedModelSchema).min(1).max(MAX_CLAIMED_MODELS),
	discountPercent: z.number().min(MIN_DISCOUNT).max(MAX_DISCOUNT),
});

const listListings = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({ organizationId: z.string().min(1) }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						listings: z.array(
							listingSchema.extend({ latestRun: testRunSchema.nullable() }),
						),
					}),
				},
			},
			description: "Provider listings owned by the organization",
		},
	},
});

providerListings.openapi(listListings, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { organizationId } = c.req.valid("query");
	await requireOrgAdmin(user.id, organizationId);

	const rows = await db.query.providerListingRequest.findMany({
		where: { organizationId },
		orderBy: { createdAt: "desc" },
	});

	const listings = await Promise.all(
		rows.map(async (row) => {
			const latestRun = await db.query.providerListingTestRun.findFirst({
				where: { listingRequestId: row.id },
				orderBy: { createdAt: "desc" },
			});
			return {
				...serializeListing(row),
				latestRun: latestRun ? serializeTestRun(latestRun) : null,
			};
		}),
	);

	return c.json({ listings }, 200);
});

const createListing = createRoute({
	method: "post",
	path: "/",
	request: {
		body: {
			content: { "application/json": { schema: createListingSchema } },
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						listing: listingSchema,
						checkoutUrl: z.string().nullable(),
					}),
				},
			},
			description: "Provider listing created",
		},
	},
});

providerListings.openapi(createListing, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message: "Please verify your email address before creating a listing",
		});
	}
	const body = c.req.valid("json");
	const organization = await requireOrgAdmin(user.id, body.organizationId);

	const providerSlug = slugifyProviderName(body.providerName);
	if (!providerSlug) {
		throw new HTTPException(400, {
			message: "Provider name must contain at least one letter or number",
		});
	}
	// A slug colliding with a catalogue provider would let a listing buy a
	// routing boost for a provider it does not own.
	if (providers.some((p) => p.id === providerSlug)) {
		throw new HTTPException(400, {
			message: `"${body.providerName}" conflicts with an existing provider. Contact us to update an existing listing.`,
		});
	}
	const existingSlug = await db.query.providerListingRequest.findFirst({
		where: { providerSlug, archivedAt: { isNull: true } },
	});
	if (existingSlug) {
		throw new HTTPException(400, {
			message: `A listing for "${body.providerName}" already exists`,
		});
	}

	assertClaimedModelsValid(body.claimedModels);
	await assertProviderBaseUrlAllowed(body.baseUrl);

	const id = shortid();
	const [listing] = await db
		.insert(tables.providerListingRequest)
		.values({
			id,
			organizationId: organization.id,
			providerName: body.providerName,
			providerSlug,
			email: user.email,
			url: body.url,
			termsUrl: body.termsUrl,
			privacyUrl: body.privacyUrl,
			statusPageUrl: body.statusPageUrl ?? null,
			country: body.country,
			complianceSoc2Type2: body.complianceSoc2Type2,
			complianceIso27001: body.complianceIso27001,
			complianceGdpr: body.complianceGdpr,
			dataRetentionDays: body.dataRetentionDays,
			trainsOnData: body.trainsOnData,
			baseUrl: body.baseUrl,
			testKeyCiphertext: encryptProviderKey(
				body.testApiKey,
				id,
				organization.id,
			),
			testKeyMasked: maskToken(body.testApiKey),
			claimedModels: body.claimedModels,
			discountPercent: body.discountPercent.toString(),
			// Self-serve listings are created by an authenticated org admin behind
			// a paywall, so the contact-form spam pipeline does not apply.
			spamFilterStatus: "delivered",
			ipAddress: getClientIpFromContext(c),
			userAgent: c.req.header("User-Agent") ?? null,
		})
		.returning();

	const checkoutUrl = await createListingCheckoutSession({
		id: listing.id,
		providerName: listing.providerName,
		organizationId: organization.id,
	});

	void notifyProviderContact({
		providerName: body.providerName,
		email: user.email,
		url: body.url,
		termsUrl: body.termsUrl,
		privacyUrl: body.privacyUrl,
		statusPageUrl: body.statusPageUrl ?? null,
		country: body.country,
		compliance: [
			body.complianceSoc2Type2 ? "SOC 2 Type II" : null,
			body.complianceIso27001 ? "ISO 27001" : null,
			body.complianceGdpr ? "GDPR" : null,
		]
			.filter(Boolean)
			.join(", "),
		dataRetentionDays: body.dataRetentionDays,
		trainsOnData: body.trainsOnData,
		ipAddress: getClientIpFromContext(c),
	}).catch((err) => {
		logger.error(
			"Failed to send provider listing Discord notification",
			err instanceof Error ? err : new Error(String(err)),
		);
	});

	return c.json({ listing: serializeListing(listing), checkoutUrl }, 200);
});

/**
 * The checks the validation suite will require for each claimed model, so the
 * dashboard can show what a run will cover before it is queued. Registered
 * before the parameterized GET so "expected-checks" never matches as an id.
 */
const getExpectedChecks = createRoute({
	method: "get",
	path: "/expected-checks",
	request: {
		query: z.object({ modelIds: z.string().min(1) }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						checks: z.record(
							z.string(),
							z.array(z.enum(["chat", "streaming", "json_mode", "tool_calls"])),
						),
					}),
				},
			},
			description: "Required checks per model id",
		},
	},
});

providerListings.openapi(getExpectedChecks, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { modelIds } = c.req.valid("query");
	const checks = Object.fromEntries(
		modelIds
			.split(",")
			.map((m) => m.trim())
			.filter(Boolean)
			.map((modelId) => [modelId, getRequiredChecksForModel(modelId)]),
	);
	return c.json({ checks }, 200);
});

const getListing = createRoute({
	method: "get",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						listing: listingSchema,
						runs: z.array(testRunSchema),
					}),
				},
			},
			description: "Provider listing detail with recent validation runs",
		},
	},
});

providerListings.openapi(getListing, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const listing = await requireListing(user.id, id);

	const runs = await db.query.providerListingTestRun.findMany({
		where: { listingRequestId: id },
		orderBy: { createdAt: "desc" },
		limit: 10,
	});

	return c.json(
		{
			listing: serializeListing(listing),
			runs: runs.map(serializeTestRun),
		},
		200,
	);
});

const updateListing = createRoute({
	method: "patch",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						discountPercent: z
							.number()
							.min(MIN_DISCOUNT)
							.max(MAX_DISCOUNT)
							.optional(),
						baseUrl: z.string().url().optional(),
						testApiKey: z.string().min(8).optional(),
						claimedModels: z
							.array(claimedModelSchema)
							.min(1)
							.max(MAX_CLAIMED_MODELS)
							.optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ listing: listingSchema }),
				},
			},
			description: "Provider listing updated",
		},
	},
});

providerListings.openapi(updateListing, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const listing = await requireListing(user.id, id);

	if (listing.archivedAt) {
		throw new HTTPException(400, { message: "Listing is archived" });
	}

	const endpointChanged =
		body.baseUrl !== undefined ||
		body.testApiKey !== undefined ||
		body.claimedModels !== undefined;
	if (endpointChanged && listing.listedAt) {
		throw new HTTPException(400, {
			message:
				"Endpoint and models cannot change while the listing is live. Delist first, then re-validate.",
		});
	}

	const updates: Partial<ListingRow> = {};
	if (body.baseUrl !== undefined) {
		await assertProviderBaseUrlAllowed(body.baseUrl);
		updates.baseUrl = body.baseUrl;
	}
	if (body.testApiKey !== undefined) {
		updates.testKeyCiphertext = encryptProviderKey(
			body.testApiKey,
			listing.id,
			listing.organizationId!,
		);
		updates.testKeyMasked = maskToken(body.testApiKey);
	}
	if (body.claimedModels !== undefined) {
		assertClaimedModelsValid(body.claimedModels);
		updates.claimedModels = body.claimedModels;
	}
	if (endpointChanged) {
		// The previous verdict no longer covers the new endpoint/model set.
		updates.validationStatus = "not_started";
	}
	if (body.discountPercent !== undefined) {
		updates.discountPercent = body.discountPercent.toString();
	}

	const [updated] = await db
		.update(tables.providerListingRequest)
		.set(updates)
		.where(eq(tables.providerListingRequest.id, id))
		.returning();

	// A live listing's discount change re-prices its routing boost immediately.
	if (
		body.discountPercent !== undefined &&
		updated.listedAt &&
		updated.providerSlug
	) {
		await upsertRoutingBoost(updated, body.discountPercent);
	}

	return c.json({ listing: serializeListing(updated) }, 200);
});

const createCheckout = createRoute({
	method: "post",
	path: "/{id}/checkout",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ checkoutUrl: z.string().nullable() }),
				},
			},
			description: "New checkout session for an unpaid listing",
		},
	},
});

providerListings.openapi(createCheckout, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const listing = await requireListing(user.id, id);
	if (listing.paymentStatus !== "unpaid") {
		throw new HTTPException(400, {
			message: "The listing fee has already been paid",
		});
	}
	const checkoutUrl = await createListingCheckoutSession({
		id: listing.id,
		providerName: listing.providerName,
		organizationId: listing.organizationId!,
	});
	return c.json({ checkoutUrl }, 200);
});

const startValidation = createRoute({
	method: "post",
	path: "/{id}/validate",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ run: testRunSchema }),
				},
			},
			description: "Validation run queued",
		},
	},
});

providerListings.openapi(startValidation, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const listing = await requireListing(user.id, id);

	if (listing.archivedAt) {
		throw new HTTPException(400, { message: "Listing is archived" });
	}
	if (listing.paymentStatus !== "paid") {
		throw new HTTPException(402, {
			message: "Pay the listing fee before running validation",
		});
	}
	if (
		!listing.baseUrl ||
		!listing.testKeyCiphertext ||
		!listing.claimedModels?.length
	) {
		throw new HTTPException(400, {
			message: "Listing is missing an endpoint, test key, or claimed models",
		});
	}

	const activeRun = await db.query.providerListingTestRun.findFirst({
		where: {
			listingRequestId: id,
			status: { in: ["queued", "running"] },
		},
	});
	if (activeRun) {
		throw new HTTPException(409, {
			message: "A validation run is already in progress",
		});
	}

	const [run] = await db
		.insert(tables.providerListingTestRun)
		.values({ listingRequestId: id })
		.returning();
	await db
		.update(tables.providerListingRequest)
		.set({ validationStatus: "queued" })
		.where(eq(tables.providerListingRequest.id, id));

	return c.json({ run: serializeTestRun(run) }, 200);
});

const activateListing = createRoute({
	method: "post",
	path: "/{id}/activate",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ listing: listingSchema }),
				},
			},
			description: "Listing activated; routing boost provisioned",
		},
	},
});

providerListings.openapi(activateListing, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const listing = await requireListing(user.id, id);

	if (listing.archivedAt) {
		throw new HTTPException(400, { message: "Listing is archived" });
	}
	if (listing.listedAt) {
		throw new HTTPException(400, { message: "Listing is already live" });
	}
	if (listing.paymentStatus !== "paid") {
		throw new HTTPException(402, {
			message: "Pay the listing fee before activating",
		});
	}
	if (listing.validationStatus !== "passed") {
		throw new HTTPException(400, {
			message: "All validation tests must pass before activating",
		});
	}
	const discount = Number(listing.discountPercent ?? "0");
	if (!(discount >= MIN_DISCOUNT && discount <= MAX_DISCOUNT)) {
		throw new HTTPException(400, {
			message: "Set a discount before activating",
		});
	}
	if (!listing.providerSlug) {
		throw new HTTPException(400, { message: "Listing has no provider slug" });
	}

	await upsertRoutingBoost(listing, discount);
	const [updated] = await db
		.update(tables.providerListingRequest)
		.set({ listedAt: new Date() })
		.where(eq(tables.providerListingRequest.id, id))
		.returning();

	logger.info("Provider listing activated", {
		listingId: id,
		providerSlug: listing.providerSlug,
		discount,
	});

	return c.json({ listing: serializeListing(updated) }, 200);
});

const archiveListing = createRoute({
	method: "delete",
	path: "/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ listing: listingSchema }),
				},
			},
			description: "Listing archived and delisted",
		},
	},
});

providerListings.openapi(archiveListing, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.valid("param");
	const listing = await requireListing(user.id, id);

	if (listing.listedAt && listing.providerSlug) {
		await removeRoutingBoost(listing.providerSlug);
	}
	const [updated] = await db
		.update(tables.providerListingRequest)
		.set({ archivedAt: new Date(), listedAt: null })
		.where(eq(tables.providerListingRequest.id, id))
		.returning();

	return c.json({ listing: serializeListing(updated) }, 200);
});
