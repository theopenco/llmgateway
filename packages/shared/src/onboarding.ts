// The model the post-signup onboarding wizard's "try it now" request runs on.
// A brand new organization has no credits, so that call is sponsored by a
// platform-owned API key (`ONBOARDING_CHAT_API_KEY`) rather than the account's
// own key — which is why the model is pinned server-side in
// apps/api/src/routes/chat.ts instead of being whatever the client asks for.
// Keep it cheap: it is paid for on every signup.
export const ONBOARDING_MODEL = "runware/gpt-oss-120b";

// Onboarding answers are two sentences, and the request is on our dime, so cap
// what a sponsored call can spend.
export const ONBOARDING_MAX_TOKENS = 512;
