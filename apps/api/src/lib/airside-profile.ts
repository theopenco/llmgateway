import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { providers as catalogueProviders } from "@llmgateway/models";

import type { tables } from "@llmgateway/db";

/**
 * A carrier's self-declared public profile: links and data-policy claims
 * shown on its provider page. Display only — compliance routing keeps reading
 * the reviewed static catalogue and never these columns.
 */

function httpUrl(label: string) {
	return z
		.string({
			required_error: `Add your ${label} — it is required and shown on your public provider page.`,
		})
		.trim()
		.max(500)
		.url(`Enter a full ${label}, starting with https://`)
		.refine((value) => /^https?:\/\//i.test(value), {
			message: `The ${label} must start with http:// or https://`,
		});
}

export const carrierProfileFields = {
	website: httpUrl("website"),
	privacyPolicyUrl: httpUrl("privacy policy URL"),
	termsUrl: httpUrl("terms of use URL"),
	statusPageUrl: httpUrl("status page URL"),
	legalEntity: z.string().trim().min(1).max(200),
	headquarters: z
		.string()
		.regex(/^[A-Z]{2}$/, "Use an ISO 3166-1 alpha-2 country code, like US"),
	apiTraining: z.boolean(),
	promptLogging: z.boolean(),
	retentionPeriod: z.string().trim().min(1).max(100),
	gdpr: z.boolean(),
	// 0 = none, 1 = Type I, 2 = Type II.
	soc2: z.union([z.literal(0), z.literal(1), z.literal(2)]),
	iso27001: z.boolean(),
};

export type CarrierProfileKey = keyof typeof carrierProfileFields;

export const PROFILE_REQUIRED_KEYS = [
	"website",
	"privacyPolicyUrl",
	"termsUrl",
] as const satisfies readonly CarrierProfileKey[];

export const PROFILE_RECOMMENDED_KEYS = [
	"statusPageUrl",
	"legalEntity",
	"headquarters",
	"apiTraining",
	"promptLogging",
	"retentionPeriod",
	"gdpr",
	"soc2",
	"iso27001",
] as const satisfies readonly CarrierProfileKey[];

const PROFILE_KEYS: readonly CarrierProfileKey[] = [
	...PROFILE_REQUIRED_KEYS,
	...PROFILE_RECOMMENDED_KEYS,
];

/** Links and identity every carrier maintains itself. */
export const PROFILE_LINK_KEYS = [
	"website",
	"privacyPolicyUrl",
	"termsUrl",
	"statusPageUrl",
	"legalEntity",
	"headquarters",
] as const satisfies readonly CarrierProfileKey[];

/**
 * Data-policy claims. Catalogue providers keep LLM Gateway's reviewed policy,
 * which also drives compliance routing, so only custom carriers declare one.
 */
export const PROFILE_POLICY_KEYS = [
	"apiTraining",
	"promptLogging",
	"retentionPeriod",
	"gdpr",
	"soc2",
	"iso27001",
] as const satisfies readonly CarrierProfileKey[];

const LINK_KEYS: readonly CarrierProfileKey[] = PROFILE_LINK_KEYS;

const PROFILE_LABELS: Record<CarrierProfileKey, string> = {
	website: "website",
	privacyPolicyUrl: "privacy policy URL",
	termsUrl: "terms of use URL",
	statusPageUrl: "status page URL",
	legalEntity: "legal entity",
	headquarters: "headquarters",
	apiTraining: "API training policy",
	promptLogging: "prompt logging policy",
	retentionPeriod: "retention period",
	gdpr: "GDPR status",
	soc2: "SOC 2 status",
	iso27001: "ISO 27001 status",
};

/** Every field optional — what a claim may submit at filing time. */
export const carrierProfileInputSchema = z
	.object(carrierProfileFields)
	.partial();

/** Registration body: the required trio must be present. */
export const carrierProfileRegistrationSchema = z.object(
	{
		...carrierProfileInputSchema.shape,
		website: carrierProfileFields.website,
		privacyPolicyUrl: carrierProfileFields.privacyPolicyUrl,
		termsUrl: carrierProfileFields.termsUrl,
	},
	{
		required_error:
			"Add your website, privacy policy URL and terms of use URL — they are required and shown on your public provider page.",
	},
);

/** PATCH body: omitted keeps a field, null clears an optional one. */
export const carrierProfilePatchSchema = z.object({
	website: carrierProfileFields.website.nullish(),
	privacyPolicyUrl: carrierProfileFields.privacyPolicyUrl.nullish(),
	termsUrl: carrierProfileFields.termsUrl.nullish(),
	statusPageUrl: carrierProfileFields.statusPageUrl.nullish(),
	legalEntity: carrierProfileFields.legalEntity.nullish(),
	headquarters: carrierProfileFields.headquarters.nullish(),
	apiTraining: carrierProfileFields.apiTraining.nullish(),
	promptLogging: carrierProfileFields.promptLogging.nullish(),
	retentionPeriod: carrierProfileFields.retentionPeriod.nullish(),
	gdpr: carrierProfileFields.gdpr.nullish(),
	soc2: carrierProfileFields.soc2.nullish(),
	iso27001: carrierProfileFields.iso27001.nullish(),
});

export const carrierProfileSchema = z.object({
	website: z.string().nullable(),
	privacyPolicyUrl: z.string().nullable(),
	termsUrl: z.string().nullable(),
	statusPageUrl: z.string().nullable(),
	legalEntity: z.string().nullable(),
	headquarters: z.string().nullable(),
	apiTraining: z.boolean().nullable(),
	promptLogging: z.boolean().nullable(),
	retentionPeriod: z.string().nullable(),
	gdpr: z.boolean().nullable(),
	soc2: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
	iso27001: z.boolean().nullable(),
});

export type CarrierProfile = z.infer<typeof carrierProfileSchema>;
export type CarrierProfileInput = z.infer<typeof carrierProfileInputSchema>;

export const profileDefaultsSchema = z.object({
	website: z.string().nullable(),
	privacyPolicyUrl: z.string().nullable(),
	termsUrl: z.string().nullable(),
	statusPageUrl: z.string().nullable(),
});

type ProviderClaimRow = typeof tables.providerClaim.$inferSelect;
type ProfileColumns = Pick<ProviderClaimRow, CarrierProfileKey>;
type ClaimProfileColumns = ProfileColumns &
	Pick<ProviderClaimRow, "providerId" | "kind" | "profileUpdatedAt">;

const EMPTY_PROFILE: CarrierProfile = {
	website: null,
	privacyPolicyUrl: null,
	termsUrl: null,
	statusPageUrl: null,
	legalEntity: null,
	headquarters: null,
	apiTraining: null,
	promptLogging: null,
	retentionPeriod: null,
	gdpr: null,
	soc2: null,
	iso27001: null,
};

function soc2Value(value: number | null | undefined): CarrierProfile["soc2"] {
	return value === 0 || value === 1 || value === 2 ? value : null;
}

/** The reviewed static catalogue's profile for a provider, if it has one. */
export function staticCarrierProfile(providerId: string): CarrierProfile {
	const definition = catalogueProviders.find((p) => p.id === providerId);
	if (!definition) {
		return EMPTY_PROFILE;
	}
	const policy = definition.dataPolicy;
	return {
		website: definition.website ?? null,
		privacyPolicyUrl: definition.privacyPolicyUrl ?? null,
		termsUrl: definition.termsUrl ?? null,
		statusPageUrl: definition.statusPageUrl ?? null,
		legalEntity: definition.legalEntity ?? null,
		headquarters: definition.headquarters ?? null,
		apiTraining: policy?.apiTraining ?? null,
		promptLogging: policy?.promptLogging ?? null,
		retentionPeriod: policy?.retentionPeriod ?? null,
		gdpr: policy?.gdpr ?? null,
		// In the catalogue an explicit null soc2 means "not certified".
		soc2: policy && policy.soc2 !== undefined ? (policy.soc2 ?? 0) : null,
		iso27001: policy?.iso27001 ?? null,
	};
}

export function profileDefaults(providerId: string) {
	const profile = staticCarrierProfile(providerId);
	return {
		website: profile.website,
		privacyPolicyUrl: profile.privacyPolicyUrl,
		termsUrl: profile.termsUrl,
		statusPageUrl: profile.statusPageUrl,
	};
}

function ownProfile(row: ProfileColumns): CarrierProfile {
	return {
		website: row.website,
		privacyPolicyUrl: row.privacyPolicyUrl,
		termsUrl: row.termsUrl,
		statusPageUrl: row.statusPageUrl,
		legalEntity: row.legalEntity,
		headquarters: row.headquarters,
		apiTraining: row.apiTraining,
		promptLogging: row.promptLogging,
		retentionPeriod: row.retentionPeriod,
		gdpr: row.gdpr,
		soc2: soc2Value(row.soc2),
		iso27001: row.iso27001,
	};
}

/**
 * Custom carriers show exactly what they declared. Catalogue claims always
 * show the reviewed data policy; their links fall back to the catalogue until
 * the carrier first saves a profile, after which the saved links stand alone
 * so a cleared optional link stays cleared.
 */
export function effectiveCarrierProfile(
	row: ClaimProfileColumns,
): CarrierProfile {
	const own = ownProfile(row);
	if (row.kind !== "catalogue") {
		return own;
	}
	const reviewed = staticCarrierProfile(row.providerId);
	const profile: Record<string, unknown> = { ...reviewed };
	for (const key of PROFILE_LINK_KEYS) {
		profile[key] = row.profileUpdatedAt
			? own[key]
			: (own[key] ?? reviewed[key]);
	}
	return profile as CarrierProfile;
}

function missingKeys(
	profile: CarrierProfile,
	keys: readonly CarrierProfileKey[],
): CarrierProfileKey[] {
	return keys.filter((key) => profile[key] === null);
}

export function serializeClaimProfile(row: ClaimProfileColumns) {
	const profile = effectiveCarrierProfile(row);
	return {
		profile,
		profileMissing: missingKeys(profile, PROFILE_REQUIRED_KEYS),
		profileRecommendedMissing: missingKeys(
			profile,
			row.kind === "catalogue"
				? PROFILE_RECOMMENDED_KEYS.filter((key) => LINK_KEYS.includes(key))
				: PROFILE_RECOMMENDED_KEYS,
		),
		profileUpdatedAt: row.profileUpdatedAt?.toISOString() ?? null,
	};
}

function describeKeys(keys: readonly CarrierProfileKey[]): string {
	const labels = keys.map((key) => PROFILE_LABELS[key]);
	return labels.length > 1
		? `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`
		: (labels[0] ?? "");
}

/**
 * Throws a 400 naming the required profile fields still missing once
 * `profile` is layered over `fallback`.
 */
export function assertRequiredProfile(
	profile: CarrierProfileInput | undefined,
	fallback: CarrierProfile = EMPTY_PROFILE,
) {
	const missing = PROFILE_REQUIRED_KEYS.filter(
		(key) => !profile?.[key] && !fallback[key],
	);
	if (missing.length > 0) {
		const subject = describeKeys(missing);
		throw new HTTPException(400, {
			message: `Add your ${subject} — ${missing.length > 1 ? "they are" : "it is"} required and shown on your public provider page.`,
		});
	}
}

/** Column values for the fields present in `profile`. */
export function profileColumns(
	profile: Partial<Record<CarrierProfileKey, unknown>> | undefined,
): Partial<Pick<ProviderClaimRow, CarrierProfileKey>> {
	if (!profile) {
		return {};
	}
	const columns: Record<string, unknown> = {};
	for (const key of PROFILE_KEYS) {
		if (profile[key] !== undefined) {
			columns[key] = profile[key];
		}
	}
	return columns as Partial<Pick<ProviderClaimRow, CarrierProfileKey>>;
}

/** Rejects data-policy fields on catalogue claims; see PROFILE_POLICY_KEYS. */
export function assertEditableProfile(
	kind: ProviderClaimRow["kind"],
	profile: Partial<Record<CarrierProfileKey, unknown>> | undefined,
) {
	if (
		kind === "catalogue" &&
		PROFILE_POLICY_KEYS.some((key) => profile?.[key] !== undefined)
	) {
		throw new HTTPException(400, {
			message:
				"Catalogue providers keep LLM Gateway's reviewed data policy. Contact us to change it.",
		});
	}
}

/**
 * Every link column of a catalogue claim: `profile` over `base`. Writing the
 * full set on each save snapshots the catalogue links the carrier was shown.
 */
export function catalogueLinkColumns(
	base: CarrierProfile,
	profile: Partial<Record<CarrierProfileKey, unknown>> | undefined,
): Partial<Pick<ProviderClaimRow, CarrierProfileKey>> {
	const columns: Record<string, unknown> = {};
	for (const key of PROFILE_LINK_KEYS) {
		columns[key] = profile?.[key] !== undefined ? profile[key] : base[key];
	}
	return columns as Partial<Pick<ProviderClaimRow, CarrierProfileKey>>;
}

/** Rejects a PATCH that clears one of the required fields. */
export function assertNoRequiredCleared(
	patch: Partial<Record<CarrierProfileKey, unknown>>,
) {
	const cleared = PROFILE_REQUIRED_KEYS.filter((key) => patch[key] === null);
	if (cleared.length > 0) {
		throw new HTTPException(400, {
			message: `Your ${describeKeys(cleared)} ${cleared.length > 1 ? "are" : "is"} required and can't be removed — replace ${cleared.length > 1 ? "them" : "it"} instead.`,
		});
	}
}

/**
 * The public profile for the provider page, from the live claim's own
 * columns. Catalogue claims publish their links only once saved and keep the
 * reviewed data policy (null here); custom carriers publish everything they
 * declared. Null when there is nothing to publish.
 */
export function publicAirsideProfile(row: ClaimProfileColumns) {
	const own = ownProfile(row);
	const links = {
		website: own.website,
		statusPageUrl: own.statusPageUrl,
		termsUrl: own.termsUrl,
		privacyPolicyUrl: own.privacyPolicyUrl,
		legalEntity: own.legalEntity,
		headquarters: own.headquarters,
	};
	if (row.kind === "catalogue") {
		return row.profileUpdatedAt ? { ...links, dataPolicy: null } : null;
	}
	if (PROFILE_KEYS.every((key) => own[key] === null)) {
		return null;
	}
	return {
		...links,
		dataPolicy: {
			apiTraining: own.apiTraining,
			promptLogging: own.promptLogging,
			retentionPeriod: own.retentionPeriod,
			gdpr: own.gdpr,
			soc2: own.soc2,
			iso27001: own.iso27001,
		},
	};
}

export const publicAirsideProfileSchema = z.object({
	website: z.string().nullable(),
	statusPageUrl: z.string().nullable(),
	termsUrl: z.string().nullable(),
	privacyPolicyUrl: z.string().nullable(),
	legalEntity: z.string().nullable(),
	headquarters: z.string().nullable(),
	dataPolicy: z
		.object({
			apiTraining: z.boolean().nullable(),
			promptLogging: z.boolean().nullable(),
			retentionPeriod: z.string().nullable(),
			gdpr: z.boolean().nullable(),
			soc2: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
			iso27001: z.boolean().nullable(),
		})
		.nullable(),
});
