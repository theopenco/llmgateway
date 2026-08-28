import { describe, expect, it } from "vitest";

import { providers } from "./providers.js";

/**
 * A ratchet on the catalogue's data-protection coverage.
 *
 * The Q3 2026 GDPR audit found that a provider had been added mid-quarter with
 * no `dataPolicy`, no privacy-policy URL and no disclosed `headquarters`, and
 * that nobody noticed until the quarterly review. These tests make that
 * impossible: the gaps that exist today are listed below and tolerated, and
 * anything *new* fails the build.
 *
 * When you add a provider, the fix is to fill in its `dataPolicy` and
 * `headquarters` — not to add it to a baseline. Only add to a baseline when the
 * information genuinely cannot be obtained (an undisclosed "stealth" provider),
 * and record why in `docs/gdpr-compliance-plan.md` §5 at the same time.
 *
 * When a provider's data policy IS obtained, remove it from the baseline. These
 * lists are expected to shrink; a test asserts they contain no stale entries so
 * they cannot quietly rot.
 */

/**
 * Providers with no `dataPolicy` at all. Almost all are undisclosed platforms
 * serving preview models under confidentiality — we have no policy to record
 * because their operator is not disclosed to us.
 */
const NO_DATA_POLICY_BASELINE = new Set([
	"glacier",
	"iceberg",
	"granite",
	"quartz",
	"avalanche",
	"tundra",
	"permafrost",
	"sakana",
	"reve",
	"gonka24",
]);

/**
 * Providers with a `dataPolicy` that does not state a GDPR position. Several
 * are headquartered in countries with no EU adequacy decision, which is the
 * open Art. 46 exposure tracked in `docs/gdpr-compliance-plan.md` §5.
 */
const NO_GDPR_POSITION_BASELINE = new Set([
	"deepseek",
	"alibaba",
	"novita",
	"zai",
	"moonshot",
	"nebius",
	"inference.net",
	"together-ai",
	"scx-ai",
	"scx-ai-gp",
	"nanogpt",
	"bytedance",
	"minimax",
	"embercloud",
	"xiaomi",
	"runware",
	"ranoai",
]);

/**
 * Providers with no `privacyPolicyUrl`. The Privacy Policy tells users to review
 * a provider's policy before routing to it, so a missing link makes that
 * instruction impossible to follow — it is a disclosure gap, not just missing
 * metadata.
 */
const NO_PRIVACY_POLICY_URL_BASELINE = new Set([
	"glacier",
	"iceberg",
	"granite",
	"quartz",
	"avalanche",
	"tundra",
	"permafrost",
	"gonka24",
]);

/** Providers whose headquarters are not disclosed. */
const NO_HEADQUARTERS_BASELINE = new Set([
	"glacier",
	"iceberg",
	"granite",
	"quartz",
	"avalanche",
	"tundra",
	"permafrost",
	"atlascloud",
	"gonka24",
]);

/**
 * Not real upstream platforms, so they have no data policy of their own:
 * `llmgateway` is the internal routing pseudo-provider, and `custom` stands in
 * for an organization's own endpoints, whose posture is captured per-org as a
 * compliance attestation instead.
 */
const STRUCTURALLY_EXEMPT = new Set(["llmgateway", "custom"]);

const auditable = providers.filter((p) => !STRUCTURALLY_EXEMPT.has(p.id));

describe("provider data-protection coverage", () => {
	it("has no new provider without a data policy", () => {
		const offenders = auditable
			.filter((p) => !p.dataPolicy && !NO_DATA_POLICY_BASELINE.has(p.id))
			.map((p) => p.id);

		expect(
			offenders,
			`These providers have no dataPolicy. Add one — personal data routed to a provider with no documented data-protection posture has no basis. If the provider is undisclosed and no policy can be obtained, add it to NO_DATA_POLICY_BASELINE and record why in docs/gdpr-compliance-plan.md §5.`,
		).toEqual([]);
	});

	it("has no new provider without a stated GDPR position", () => {
		const offenders = auditable
			.filter(
				(p) =>
					p.dataPolicy &&
					p.dataPolicy.gdpr === undefined &&
					!NO_GDPR_POSITION_BASELINE.has(p.id),
			)
			.map((p) => p.id);

		expect(
			offenders,
			`These providers declare a dataPolicy but no 'gdpr' value. Set it explicitly (true/false/null) — an omitted value silently fails every compliance policy that requires GDPR, which is correct but undiagnosable.`,
		).toEqual([]);
	});

	it("has no new provider without disclosed headquarters", () => {
		const offenders = auditable
			.filter((p) => !p.headquarters && !NO_HEADQUARTERS_BASELINE.has(p.id))
			.map((p) => p.id);

		expect(
			offenders,
			`These providers have no 'headquarters'. It is what the country-allowlist compliance control filters on, and what customers use to judge a transfer — a provider without one is blocked whenever an allowlist is set (fail-closed), so an omission silently makes the provider unroutable for those customers.`,
		).toEqual([]);
	});

	it("has no new provider without a privacy policy link", () => {
		const offenders = auditable
			.filter(
				(p) => !p.privacyPolicyUrl && !NO_PRIVACY_POLICY_URL_BASELINE.has(p.id),
			)
			.map((p) => p.id);

		expect(
			offenders,
			`These providers have no 'privacyPolicyUrl'. Our Privacy Policy tells users to review a provider's own policy before routing to it, which they cannot do without the link.`,
		).toEqual([]);
	});

	it("keeps the baselines free of stale entries", () => {
		const ids = new Set(providers.map((p) => p.id));

		// An id that no longer exists, or a provider that has since been
		// documented, must come out of the baseline — otherwise the ratchet
		// silently loosens and the next regression slips through.
		const stale = {
			noDataPolicy: [...NO_DATA_POLICY_BASELINE].filter((id) => {
				const provider = providers.find((p) => p.id === id);
				return !ids.has(id) || Boolean(provider?.dataPolicy);
			}),
			noGdprPosition: [...NO_GDPR_POSITION_BASELINE].filter((id) => {
				const provider = providers.find((p) => p.id === id);
				// A provider that has lost its `dataPolicy` altogether belongs in
				// NO_DATA_POLICY_BASELINE, not here — without this check it would sit
				// in the wrong list and the data-policy test would stop covering it.
				return (
					!ids.has(id) ||
					!provider?.dataPolicy ||
					provider.dataPolicy.gdpr !== undefined
				);
			}),
			noPrivacyPolicyUrl: [...NO_PRIVACY_POLICY_URL_BASELINE].filter((id) => {
				const provider = providers.find((p) => p.id === id);
				return !ids.has(id) || Boolean(provider?.privacyPolicyUrl);
			}),
			noHeadquarters: [...NO_HEADQUARTERS_BASELINE].filter((id) => {
				const provider = providers.find((p) => p.id === id);
				return !ids.has(id) || Boolean(provider?.headquarters);
			}),
		};

		expect(stale).toEqual({
			noDataPolicy: [],
			noGdprPosition: [],
			noPrivacyPolicyUrl: [],
			noHeadquarters: [],
		});
	});
});
