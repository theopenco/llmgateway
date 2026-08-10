// The model the post-signup onboarding wizard's "try it now" request runs on.
// "auto" so onboarding never pins a specific model that later gets retired or
// repriced — the router picks whatever is healthy at the time.
export const ONBOARDING_MODEL = "auto";

// Onboarding answers are two sentences, and that one call is on us, so cap the
// output. Applied server-side in apps/api/src/routes/chat.ts rather than
// trusted from the request body.
export const ONBOARDING_MAX_TOKENS = 512;

// Header the API proxy uses to tell the gateway "this request is the onboarding
// wizard's first call, don't charge for it". Carries a shared secret, because
// the gateway cannot otherwise distinguish it from an ordinary request that
// simply set `onboarding: true` in its body.
export const ONBOARDING_SPONSOR_HEADER = "x-onboarding-sponsor";

// A brand new organization has 0 credits, so the wizard's first call would 402.
// Rather than granting credits — which are fungible, bankable and would show up
// in every credit metric — that single call is zero-rated: it runs on the
// account's own API key (so it lands in their logs and usage like any other
// request) and simply costs nothing. The value of a farmed account is therefore
// one capped completion, not a spendable balance.
export function getOnboardingSponsorSecret(): string | undefined {
	return process.env.ONBOARDING_SPONSOR_SECRET;
}
