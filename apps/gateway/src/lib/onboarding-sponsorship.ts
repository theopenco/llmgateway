/**
 * Onboarding sponsorship: the post-signup wizard's first call is zero-rated,
 * because a brand new organization has 0 credits and would otherwise get a 402
 * on the very first thing it does.
 *
 * The call still authenticates with the user's own API key, so the log row, the
 * usage rollups and the activity page all attribute to them exactly like any
 * later request. Only the price is waived: the credit gate lets it through and
 * the computed cost is zeroed, so nothing is debited and no credits ever change
 * hands. That is deliberately different from granting credits — a grant is
 * fungible and bankable, whereas this is one capped completion that cannot be
 * saved, redirected, or spent on anything else.
 *
 * Eligibility is decided by the API proxy (apps/api/src/routes/chat.ts), which
 * is where the session lives: it checks that the caller is signed in, has not
 * finished onboarding, and still has allowance left. The gateway cannot re-derive
 * any of that, so the proxy asserts it with a shared secret. The `onboarding`
 * body flag is NOT sufficient — it is client-supplied, and honoring it would let
 * anyone waive their own charges.
 */
import { timingSafeEqual } from "node:crypto";

import {
	ONBOARDING_SPONSOR_HEADER,
	getOnboardingSponsorSecret,
} from "@llmgateway/shared";

import type { Context } from "hono";

function secretsMatch(presented: string, expected: string): boolean {
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	// timingSafeEqual throws on length mismatch, which would itself leak length.
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether this request may be served without charging for it. False whenever the
 * secret is unset (self-hosted, local dev), so those deployments simply bill the
 * onboarding call normally instead of silently giving work away.
 */
export function isSponsoredOnboardingRequest(c: Pick<Context, "req">): boolean {
	const expected = getOnboardingSponsorSecret();
	if (!expected) {
		return false;
	}

	const presented = c.req.header(ONBOARDING_SPONSOR_HEADER);
	if (!presented) {
		return false;
	}

	return secretsMatch(presented, expected);
}
