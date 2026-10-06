import type { AirsideCompany } from "@/components/dashboard/company-context";
import type { paths } from "@/lib/api/v1";

export type CompanyClaim = AirsideCompany["claims"][number];

export type ProfilePatchBody = NonNullable<
	paths["/airside/claims/{id}/profile"]["patch"]["requestBody"]
>["content"]["application/json"];

export type TriState = "yes" | "no" | "unknown";
export type Soc2State = "none" | "type1" | "type2" | "unknown";

export interface ProfileDraft {
	website: string;
	privacyPolicyUrl: string;
	termsUrl: string;
	statusPageUrl: string;
	legalEntity: string;
	headquarters: string;
	apiTraining: TriState;
	promptLogging: TriState;
	retentionPeriod: string;
	gdpr: TriState;
	soc2: Soc2State;
	iso27001: TriState;
}

export type ProfileKey = keyof ProfileDraft;

export const REQUIRED_PROFILE_KEYS = [
	"website",
	"privacyPolicyUrl",
	"termsUrl",
] as const satisfies readonly ProfileKey[];

export const URL_PROFILE_KEYS = [
	"website",
	"privacyPolicyUrl",
	"termsUrl",
	"statusPageUrl",
] as const satisfies readonly ProfileKey[];

export const PROFILE_FIELD_LABELS: Record<ProfileKey, string> = {
	website: "website",
	privacyPolicyUrl: "privacy policy",
	termsUrl: "terms of use",
	statusPageUrl: "status page",
	legalEntity: "legal entity",
	headquarters: "headquarters",
	apiTraining: "API training policy",
	promptLogging: "prompt logging policy",
	retentionPeriod: "retention period",
	gdpr: "GDPR status",
	soc2: "SOC 2 status",
	iso27001: "ISO 27001 status",
};

export function profileFieldLabel(key: string): string {
	return key in PROFILE_FIELD_LABELS
		? PROFILE_FIELD_LABELS[key as ProfileKey]
		: key;
}

export function joinList(items: string[]): string {
	if (items.length <= 1) {
		return items.join("");
	}
	return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value.trim());
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function toTri(value: boolean | null | undefined): TriState {
	return value === true ? "yes" : value === false ? "no" : "unknown";
}

function fromTri(value: TriState): boolean | null {
	return value === "yes" ? true : value === "no" ? false : null;
}

function toSoc2(value: unknown): Soc2State {
	return value === 0
		? "none"
		: value === 1
			? "type1"
			: value === 2
				? "type2"
				: "unknown";
}

function fromSoc2(value: Soc2State): 0 | 1 | 2 | null {
	return value === "none"
		? 0
		: value === "type1"
			? 1
			: value === "type2"
				? 2
				: null;
}

export function profileToDraft(profile: CompanyClaim["profile"]): ProfileDraft {
	return {
		website: profile.website ?? "",
		privacyPolicyUrl: profile.privacyPolicyUrl ?? "",
		termsUrl: profile.termsUrl ?? "",
		statusPageUrl: profile.statusPageUrl ?? "",
		legalEntity: profile.legalEntity ?? "",
		headquarters: profile.headquarters ?? "",
		apiTraining: toTri(profile.apiTraining),
		promptLogging: toTri(profile.promptLogging),
		retentionPeriod: profile.retentionPeriod ?? "",
		gdpr: toTri(profile.gdpr),
		soc2: toSoc2(profile.soc2),
		iso27001: toTri(profile.iso27001),
	};
}

const TRI_KEYS = ["apiTraining", "promptLogging", "gdpr", "iso27001"] as const;
const TEXT_KEYS = [
	"website",
	"privacyPolicyUrl",
	"termsUrl",
	"statusPageUrl",
	"legalEntity",
	"headquarters",
	"retentionPeriod",
] as const;

export function changedProfileKeys(
	draft: ProfileDraft,
	initial: ProfileDraft,
): ProfileKey[] {
	return (Object.keys(draft) as ProfileKey[]).filter(
		(key) => draft[key].trim() !== initial[key].trim(),
	);
}

export function profilePatchBody(
	draft: ProfileDraft,
	initial: ProfileDraft,
): ProfilePatchBody {
	const changed = new Set(changedProfileKeys(draft, initial));
	const body: ProfilePatchBody = {};
	for (const key of TEXT_KEYS) {
		if (changed.has(key)) {
			body[key] = draft[key].trim() || null;
		}
	}
	for (const key of TRI_KEYS) {
		if (changed.has(key)) {
			body[key] = fromTri(draft[key]);
		}
	}
	if (changed.has("soc2")) {
		body.soc2 = fromSoc2(draft.soc2);
	}
	return body;
}

export function profileFieldError(
	key: ProfileKey,
	draft: ProfileDraft,
): string | null {
	const value = draft[key].trim();
	if (
		(REQUIRED_PROFILE_KEYS as readonly ProfileKey[]).includes(key) &&
		!value
	) {
		return "Required.";
	}
	if (
		value &&
		(URL_PROFILE_KEYS as readonly ProfileKey[]).includes(key) &&
		!isHttpUrl(value)
	) {
		return "Enter a full http(s) URL, e.g. https://example.com/privacy.";
	}
	return null;
}

export function draftToPublicPolicy(draft: ProfileDraft) {
	return {
		apiTraining: fromTri(draft.apiTraining),
		promptLogging: fromTri(draft.promptLogging),
		gdpr: fromTri(draft.gdpr),
		iso27001: fromTri(draft.iso27001),
		soc2: fromSoc2(draft.soc2),
		retentionPeriod: draft.retentionPeriod.trim() || null,
	};
}

export const HEADQUARTERS_CODES = [
	"AE",
	"AU",
	"AT",
	"BE",
	"BR",
	"CA",
	"CH",
	"CN",
	"CZ",
	"DE",
	"DK",
	"EE",
	"ES",
	"FI",
	"FR",
	"GB",
	"HK",
	"IE",
	"IL",
	"IN",
	"IT",
	"JP",
	"KE",
	"KR",
	"KZ",
	"MX",
	"NG",
	"NL",
	"NO",
	"NZ",
	"PL",
	"PT",
	"SA",
	"SE",
	"SG",
	"TW",
	"UA",
	"US",
	"ZA",
] as const;

const regionNames =
	typeof Intl !== "undefined" && "DisplayNames" in Intl
		? new Intl.DisplayNames(["en"], { type: "region" })
		: null;

export function countryName(code: string): string {
	try {
		return regionNames?.of(code) ?? code;
	} catch {
		return code;
	}
}
