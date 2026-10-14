import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import { db, tables } from "@llmgateway/db";
import { providers } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

/**
 * Per-provider record of whether a GDPR data-processing agreement is in force,
 * confirmed one provider at a time from the admin dashboard.
 *
 * The record is stored on the `provider` table (`dpaSignedAt` / `dpaSignedBy` /
 * `dpaNote`). "Signed" means the agreement is evidenced per
 * `legal/SUBPROCESSOR_DPAS.md` — a filed artifact, not just a vendor page that
 * claims incorporation. When the `REQUIRE_PROVIDER_DPA_FOR_GDPR` environment
 * flag is enabled, the gateway additionally requires this record before a
 * provider can satisfy a compliance policy's `requireGdpr` control, so marking
 * a provider signed/unsigned changes live routing for those organizations.
 */

export const adminProviderDpas = new OpenAPIHono<ServerTypes>();

adminProviderDpas.use("/*", adminMiddleware);

/**
 * Pseudo-providers with no upstream operator to contract with: `llmgateway` is
 * the internal router and `custom` stands in for an organization's own
 * endpoints, whose posture is captured per-org as a compliance attestation.
 */
const DPA_EXEMPT_PROVIDER_IDS = new Set(["llmgateway", "custom"]);

export function isDpaEnforcementEnabled(): boolean {
	return process.env.REQUIRE_PROVIDER_DPA_FOR_GDPR === "true";
}

const providerDpaSchema = z.object({
	providerId: z.string(),
	name: z.string(),
	// Catalogue posture, shown so the admin can see which rows the gateway's
	// `requireGdpr` control considers at all (only gdpr === true providers can
	// pass it; the DPA record is an additional requirement, not a substitute).
	gdpr: z.boolean().nullable(),
	headquarters: z.string().nullable(),
	dpaSignedAt: z.string().nullable(),
	dpaSignedBy: z.string().nullable(),
	dpaNote: z.string().nullable(),
});

const listProviderDpas = createRoute({
	method: "get",
	path: "/provider-dpas",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providers: z.array(providerDpaSchema),
						/**
						 * Whether the gateway currently requires a signed DPA for
						 * `requireGdpr` routing (REQUIRE_PROVIDER_DPA_FOR_GDPR).
						 */
						enforcementEnabled: z.boolean(),
					}),
				},
			},
			description: "DPA status for every catalogue provider.",
		},
	},
});

adminProviderDpas.openapi(listProviderDpas, async (c) => {
	const rows = await db.query.provider.findMany({
		columns: {
			id: true,
			dpaSignedAt: true,
			dpaSignedBy: true,
			dpaNote: true,
		},
	});
	const rowById = new Map(rows.map((row) => [row.id, row]));

	// The catalogue is the source of truth for which providers exist; the DB
	// row only carries the DPA record (and may not exist yet on a fresh
	// environment, which reads as "not signed").
	const result = providers
		.filter((provider) => !DPA_EXEMPT_PROVIDER_IDS.has(provider.id))
		.map((provider) => {
			const row = rowById.get(provider.id);
			return {
				providerId: provider.id,
				name: provider.name,
				gdpr: provider.dataPolicy?.gdpr ?? null,
				headquarters: provider.headquarters ?? null,
				dpaSignedAt: row?.dpaSignedAt?.toISOString() ?? null,
				dpaSignedBy: row?.dpaSignedBy ?? null,
				dpaNote: row?.dpaNote ?? null,
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	return c.json({
		providers: result,
		enforcementEnabled: isDpaEnforcementEnabled(),
	});
});

const updateProviderDpa = createRoute({
	method: "put",
	path: "/provider-dpas/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						signed: z.boolean(),
						signedBy: z.string().max(200).optional(),
						note: z.string().max(2000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ provider: providerDpaSchema }),
				},
			},
			description: "The updated DPA record.",
		},
	},
});

adminProviderDpas.openapi(updateProviderDpa, async (c) => {
	const { providerId } = c.req.valid("param");
	const { signed, signedBy, note } = c.req.valid("json");
	// adminMiddleware guarantees an authenticated admin user.
	const authUser = c.get("user")!;

	const definition = providers.find((provider) => provider.id === providerId);
	if (!definition || DPA_EXEMPT_PROVIDER_IDS.has(providerId)) {
		throw new HTTPException(404, {
			message: `Unknown provider: ${providerId}`,
		});
	}

	const dpaFields = signed
		? {
				dpaSignedAt: new Date(),
				dpaSignedBy: signedBy?.trim() || authUser.email,
				dpaNote: note?.trim() || null,
			}
		: {
				// Un-marking clears the whole record: a stale signedBy/note next
				// to a null signedAt would read as evidence that no longer exists.
				dpaSignedAt: null,
				dpaSignedBy: null,
				dpaNote: null,
			};

	// Upsert: on a fresh environment the catalogue provider may not have a DB
	// row yet (rows are normally created by seeding/stats sync).
	const [row] = await db
		.insert(tables.provider)
		.values({
			id: providerId,
			name: definition.name,
			description: definition.description,
			...dpaFields,
		})
		.onConflictDoUpdate({
			target: tables.provider.id,
			set: dpaFields,
		})
		.returning({
			dpaSignedAt: tables.provider.dpaSignedAt,
			dpaSignedBy: tables.provider.dpaSignedBy,
			dpaNote: tables.provider.dpaNote,
		});

	return c.json({
		provider: {
			providerId,
			name: definition.name,
			gdpr: definition.dataPolicy?.gdpr ?? null,
			headquarters: definition.headquarters ?? null,
			dpaSignedAt: row.dpaSignedAt?.toISOString() ?? null,
			dpaSignedBy: row.dpaSignedBy,
			dpaNote: row.dpaNote,
		},
	});
});

export default adminProviderDpas;
