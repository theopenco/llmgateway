import { randomInt } from "node:crypto";

import { z } from "zod";

import type { CarrierProfile } from "./airside-profile.js";
import type { AirworthyAttestedProfile, tables } from "@llmgateway/db";

type CertificationRow = typeof tables.providerCertification.$inferSelect;

export const AIRWORTHY_VALIDITY_MONTHS = 12;

export const ATTESTED_KEYS = [
	"legalEntity",
	"headquarters",
	"apiTraining",
	"promptLogging",
	"retentionPeriod",
	"gdpr",
	"soc2",
	"iso27001",
] as const satisfies readonly (keyof AirworthyAttestedProfile)[];

export type AttestedKey = (typeof ATTESTED_KEYS)[number];

/** A certificate states these; the rest are attested only when declared. */
export const REQUIRED_ATTESTED_KEYS = [
	"legalEntity",
	"headquarters",
	"apiTraining",
	"promptLogging",
	"retentionPeriod",
] as const satisfies readonly AttestedKey[];

export const attestedProfileSchema = z.object({
	legalEntity: z.string().nullable(),
	headquarters: z.string().nullable(),
	apiTraining: z.boolean().nullable(),
	promptLogging: z.boolean().nullable(),
	retentionPeriod: z.string().nullable(),
	gdpr: z.boolean().nullable(),
	soc2: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
	iso27001: z.boolean().nullable(),
});

export function attestedFromProfile(
	profile: CarrierProfile,
): AirworthyAttestedProfile {
	return {
		legalEntity: profile.legalEntity,
		headquarters: profile.headquarters,
		apiTraining: profile.apiTraining,
		promptLogging: profile.promptLogging,
		retentionPeriod: profile.retentionPeriod,
		gdpr: profile.gdpr,
		soc2: profile.soc2,
		iso27001: profile.iso27001,
	};
}

export const ATTESTED_LABELS: Record<AttestedKey, string> = {
	legalEntity: "legal entity",
	headquarters: "headquarters",
	apiTraining: "API training policy",
	promptLogging: "prompt logging policy",
	retentionPeriod: "retention period",
	gdpr: "GDPR status",
	soc2: "SOC 2 status",
	iso27001: "ISO 27001 status",
};

export function describeAttestedKeys(keys: readonly AttestedKey[]): string {
	const labels = keys.map((key) => ATTESTED_LABELS[key]);
	return labels.length > 1
		? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
		: (labels[0] ?? "");
}

export function missingAttestedKeys(profile: CarrierProfile): AttestedKey[] {
	return REQUIRED_ATTESTED_KEYS.filter((key) => profile[key] === null);
}

/** Attested claims the live profile no longer matches. */
export function driftedKeys(
	attested: AirworthyAttestedProfile,
	profile: CarrierProfile,
): AttestedKey[] {
	return ATTESTED_KEYS.filter((key) => attested[key] !== profile[key]);
}

export type CertificationState = "valid" | "expired" | "drifted";

export function certificationState(
	certification: Pick<CertificationRow, "attested" | "expiresAt">,
	profile: CarrierProfile,
	now: Date = new Date(),
): CertificationState {
	if (certification.expiresAt <= now) {
		return "expired";
	}
	return driftedKeys(certification.attested, profile).length > 0
		? "drifted"
		: "valid";
}

const NUMBER_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/** `AW1-2026-7K4Q9D`: standard, issue year, six unambiguous characters. */
export function newCertificateNumber(issuedAt: Date): string {
	let suffix = "";
	for (let i = 0; i < 6; i++) {
		suffix += NUMBER_ALPHABET[randomInt(NUMBER_ALPHABET.length)];
	}
	return `AW1-${issuedAt.getUTCFullYear()}-${suffix}`;
}

export function certificationExpiry(issuedAt: Date): Date {
	const expiresAt = new Date(issuedAt);
	expiresAt.setUTCMonth(expiresAt.getUTCMonth() + AIRWORTHY_VALIDITY_MONTHS);
	return expiresAt;
}

export const publicCertificationSchema = z.object({
	certificateNumber: z.string(),
	issuedAt: z.string(),
	expiresAt: z.string(),
	attested: attestedProfileSchema,
});

/** What the provider page shows: only a certificate that still holds. */
export function publicCertification(
	certification: CertificationRow | undefined,
	profile: CarrierProfile,
) {
	if (
		!certification ||
		certification.status !== "active" ||
		certificationState(certification, profile) !== "valid"
	) {
		return null;
	}
	return {
		certificateNumber: certification.certificateNumber,
		issuedAt: certification.issuedAt.toISOString(),
		expiresAt: certification.expiresAt.toISOString(),
		attested: certification.attested,
	};
}
