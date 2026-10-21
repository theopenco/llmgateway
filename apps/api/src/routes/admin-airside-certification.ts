import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	attestedFromProfile,
	attestedProfileSchema,
	certificationExpiry,
	certificationState,
	describeAttestedKeys,
	driftedKeys,
	missingAttestedKeys,
	newCertificateNumber,
} from "@/lib/airside-certification.js";
import {
	carrierProfileSchema,
	effectiveCarrierProfile,
	effectiveClaimKind,
} from "@/lib/airside-profile.js";
import { adminMiddleware } from "@/middleware/admin.js";

import { and, db, eq, tables } from "@llmgateway/db";
import { providers as catalogueProviders } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

/**
 * Airworthy certification of Airside carriers. Admins review a carrier's
 * declared data handling, jurisdiction and audits against evidence, then
 * issue a certificate that freezes the attested claims.
 */
export const adminAirsideCertification = new OpenAPIHono<ServerTypes>();

adminAirsideCertification.use("/*", adminMiddleware);

const attestedKeySchema = z.enum([
	"legalEntity",
	"headquarters",
	"apiTraining",
	"promptLogging",
	"retentionPeriod",
	"gdpr",
	"soc2",
	"iso27001",
]);

const adminCertificationSchema = z.object({
	id: z.string(),
	certificateNumber: z.string(),
	status: z.enum(["active", "revoked"]),
	state: z.enum(["valid", "expired", "drifted", "revoked"]),
	attested: attestedProfileSchema,
	driftedKeys: z.array(attestedKeySchema),
	reviewNote: z.string().nullable(),
	issuedAt: z.string(),
	expiresAt: z.string(),
	issuedByEmail: z.string().nullable(),
	revokedAt: z.string().nullable(),
	revokeReason: z.string().nullable(),
});

const certificationCandidateSchema = z.object({
	claimId: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	kind: z.enum(["catalogue", "custom"]),
	company: z.object({ id: z.string(), name: z.string() }),
	logoUrl: z.string().nullable(),
	iconUrl: z.string().nullable(),
	profile: carrierProfileSchema,
	missingKeys: z.array(attestedKeySchema),
	certification: adminCertificationSchema.nullable(),
	history: z.array(adminCertificationSchema),
});

type ClaimRow = typeof tables.providerClaim.$inferSelect;
type CertificationRow = typeof tables.providerCertification.$inferSelect;

function providerNameFor(claim: ClaimRow) {
	return (
		claim.customName ??
		catalogueProviders.find((provider) => provider.id === claim.providerId)
			?.name ??
		claim.providerId
	);
}

async function emailsFor(userIds: (string | null)[]) {
	const ids = [...new Set(userIds.filter((id): id is string => !!id))];
	if (ids.length === 0) {
		return new Map<string, string>();
	}
	const users = await db.query.user.findMany({
		where: { id: { in: ids } },
		columns: { id: true, email: true },
	});
	return new Map(users.map((user) => [user.id, user.email]));
}

function serializeCertification(
	row: CertificationRow,
	claim: ClaimRow,
	emails: Map<string, string>,
) {
	const profile = effectiveCarrierProfile(claim);
	return {
		id: row.id,
		certificateNumber: row.certificateNumber,
		status: row.status,
		state:
			row.status === "revoked"
				? ("revoked" as const)
				: certificationState(row, profile),
		attested: row.attested,
		driftedKeys:
			row.status === "active" ? driftedKeys(row.attested, profile) : [],
		reviewNote: row.reviewNote,
		issuedAt: row.issuedAt.toISOString(),
		expiresAt: row.expiresAt.toISOString(),
		issuedByEmail: row.issuedBy ? (emails.get(row.issuedBy) ?? null) : null,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		revokeReason: row.revokeReason,
	};
}

async function serializeCandidate(
	claim: ClaimRow & {
		providerCompany: { id: string; name: string } | null;
		certifications: CertificationRow[];
	},
	emails: Map<string, string>,
) {
	const profile = effectiveCarrierProfile(claim);
	const sorted = [...claim.certifications].sort(
		(a, b) => b.issuedAt.getTime() - a.issuedAt.getTime(),
	);
	const active = sorted.find((row) => row.status === "active");
	return {
		claimId: claim.id,
		providerId: claim.providerId,
		providerName: providerNameFor(claim),
		kind: effectiveClaimKind(claim),
		company: {
			id: claim.providerCompanyId,
			name: claim.providerCompany?.name ?? claim.providerCompanyId,
		},
		logoUrl: claim.logoUrl,
		iconUrl: claim.iconUrl,
		profile,
		missingKeys: missingAttestedKeys(profile),
		certification: active
			? serializeCertification(active, claim, emails)
			: null,
		history: sorted
			.filter((row) => row !== active)
			.map((row) => serializeCertification(row, claim, emails)),
	};
}

async function loadCandidate(claimId: string) {
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: claimId } },
		with: { providerCompany: true, certifications: true },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	const emails = await emailsFor(
		claim.certifications.map((row) => row.issuedBy),
	);
	return await serializeCandidate(claim, emails);
}

const listCertifications = createRoute({
	operationId: "admin_list_airside_certifications",
	summary: "List Airworthy certification candidates",
	method: "get",
	path: "/airside/certifications",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						carriers: z.array(certificationCandidateSchema),
					}),
				},
			},
			description:
				"Every active Airside carrier with its attestable profile and Airworthy certificate.",
		},
	},
});

adminAirsideCertification.openapi(listCertifications, async (c) => {
	const claims = await db.query.providerClaim.findMany({
		where: { status: { eq: "active" } },
		with: { providerCompany: true, certifications: true },
		orderBy: { createdAt: "asc" },
	});
	const emails = await emailsFor(
		claims.flatMap((claim) => claim.certifications.map((row) => row.issuedBy)),
	);
	const carriers = await Promise.all(
		claims.map((claim) => serializeCandidate(claim, emails)),
	);
	return c.json({
		carriers: carriers.sort((a, b) =>
			a.providerName.localeCompare(b.providerName),
		),
	});
});

const certifyClaim = createRoute({
	operationId: "admin_certify_airside_claim",
	summary: "Issue an Airworthy certificate",
	method: "post",
	path: "/airside/claims/{id}/certification",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// The evidence reviewed: DPA, terms, registry record, audit reports.
						reviewNote: z.string().trim().min(1).max(4000),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ carrier: certificationCandidateSchema }),
				},
			},
			description:
				"The carrier with its new certificate. A previous active certificate is superseded.",
		},
	},
});

adminAirsideCertification.openapi(certifyClaim, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const { reviewNote } = c.req.valid("json");
	const claim = await db.query.providerClaim.findFirst({
		where: { id: { eq: id } },
	});
	if (!claim) {
		throw new HTTPException(404, { message: "Claim not found" });
	}
	if (claim.status !== "active") {
		throw new HTTPException(409, {
			message: "Only an active carrier can be certified.",
		});
	}
	const profile = effectiveCarrierProfile(claim);
	const missing = missingAttestedKeys(profile);
	if (missing.length > 0) {
		throw new HTTPException(400, {
			message: `The carrier's profile must state its ${describeAttestedKeys(missing)} before it can be certified.`,
		});
	}
	const issuedAt = new Date();
	const certificateNumber = newCertificateNumber(issuedAt);
	await db.transaction(async (tx) => {
		await tx
			.update(tables.providerCertification)
			.set({
				status: "revoked",
				revokedAt: issuedAt,
				revokedBy: user?.id ?? null,
				revokeReason: `Superseded by ${certificateNumber}`,
			})
			.where(
				and(
					eq(tables.providerCertification.providerId, claim.providerId),
					eq(tables.providerCertification.status, "active"),
				),
			);
		await tx.insert(tables.providerCertification).values({
			providerClaimId: claim.id,
			providerId: claim.providerId,
			certificateNumber,
			attested: attestedFromProfile(profile),
			reviewNote,
			issuedAt,
			expiresAt: certificationExpiry(issuedAt),
			issuedBy: user?.id ?? null,
		});
	});
	return c.json({ carrier: await loadCandidate(claim.id) });
});

const revokeCertification = createRoute({
	operationId: "admin_revoke_airside_certification",
	summary: "Revoke an Airworthy certificate",
	method: "post",
	path: "/airside/certifications/{id}/revoke",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reason: z.string().trim().min(1).max(2000),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ carrier: certificationCandidateSchema }),
				},
			},
			description: "The carrier with the certificate revoked.",
		},
	},
});

adminAirsideCertification.openapi(revokeCertification, async (c) => {
	const user = c.get("user");
	const { id } = c.req.valid("param");
	const { reason } = c.req.valid("json");
	const [revoked] = await db
		.update(tables.providerCertification)
		.set({
			status: "revoked",
			revokedAt: new Date(),
			revokedBy: user?.id ?? null,
			revokeReason: reason,
		})
		.where(
			and(
				eq(tables.providerCertification.id, id),
				eq(tables.providerCertification.status, "active"),
			),
		)
		.returning();
	if (!revoked) {
		throw new HTTPException(409, {
			message: "Certificate not found or already revoked.",
		});
	}
	return c.json({ carrier: await loadCandidate(revoked.providerClaimId) });
});
