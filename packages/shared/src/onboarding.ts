// The model the post-signup onboarding wizard's "try it now" request runs on.
// Pinned, and re-pinned server-side in apps/api/src/routes/chat.ts rather than
// taken from the request body: the call is zero-rated, so whatever this names is
// billed to the platform's provider account. Leaving it to the caller — or to
// "auto", whose candidates are frontier models — would let a signup decide how
// much we pay. Keep it cheap: it is paid for on every signup.
export const ONBOARDING_MODEL = "deepseek/deepseek-v4-flash";

// Onboarding answers are two sentences, and that one call is on us, so cap the
// output. Applied server-side, and only to the calls we actually pay for.
export const ONBOARDING_MAX_TOKENS = 512;

// Ceiling on the prompt a zero-rated call may carry. `max_tokens` bounds only
// the output; without this a sponsored request could ship a multi-hundred-K
// token prompt that we pay to have read. Onboarding prompts are one sentence.
export const ONBOARDING_MAX_PROMPT_CHARS = 4000;

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
