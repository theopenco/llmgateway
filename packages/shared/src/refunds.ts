// Feedback collected right before a self-service refund is issued. Shared so
// the API validation, the database enum and the three dashboard dialogs
// (credits, DevPass, chat) stay in sync.

// Self-refund policy numbers. Enforced in apps/api/src/lib/self-refund.ts and
// quoted verbatim by the marketing copy, so the advertised guarantee cannot
// drift from what the endpoint actually allows.
export const SELF_REFUND_WINDOW_DAYS = 14;
export const RESET_PASS_SELF_REFUND_WINDOW_DAYS = 7;
export const SELF_REFUND_USAGE_PERCENT = 20;

export const REFUND_REASONS = [
	"not_working",
	"missing_features",
	"too_expensive",
	"bought_by_mistake",
	"switched_alternative",
	"other",
] as const;

export type RefundReason = (typeof REFUND_REASONS)[number];

// Upper bound on the optional freeform details. Matches the limit on the
// cancellation feedback form so both datasets are comparable.
export const REFUND_COMMENTS_MAX_LENGTH = 2000;

export interface RefundReasonOption {
	value: RefundReason;
	label: string;
	// Follow-up question revealed once this reason is picked. A specific
	// question gets a specific answer; a generic "why?" gets "n/a".
	prompt: string;
	placeholder: string;
}

export const REFUND_REASON_OPTIONS: readonly RefundReasonOption[] = [
	{
		value: "not_working",
		label: "It didn't work",
		prompt: "What broke?",
		placeholder:
			"Which model, and what did it do? Errors, timeouts, bad output — specifics help us fix it.",
	},
	{
		value: "missing_features",
		label: "Missing a model or feature",
		prompt: "What was missing?",
		placeholder: "The model, feature or limit you needed and couldn't get.",
	},
	{
		value: "too_expensive",
		label: "Too expensive",
		prompt: "What would have been worth paying for?",
		placeholder: "A price, a plan, or the thing that would have justified it.",
	},
	{
		value: "bought_by_mistake",
		label: "Bought it by mistake",
		prompt: "What went wrong at checkout?",
		placeholder: "Wrong plan, duplicate charge, didn't expect to be billed?",
	},
	{
		value: "switched_alternative",
		label: "Went with something else",
		prompt: "What are you using instead?",
		placeholder: "And what does it do better than us?",
	},
	{
		value: "other",
		label: "Something else",
		prompt: "What happened?",
		placeholder: "In your own words.",
	},
];

export const REFUND_REASON_HEADING = "What made you ask for a refund?";

// The reason people write "asdf" here is that a required field above a refund
// button reads like a toll gate. Say up front that it isn't one.
export const REFUND_REASON_ASSURANCE =
	"This won't affect your refund — we just want to know what to fix.";

// "Something else" carries no signal on its own, so the details are required
// there and optional everywhere else.
export function refundCommentsRequired(reason: RefundReason): boolean {
	return reason === "other";
}

// One rule for "is this answer usable?", shared by the dialogs (to gate the
// confirm button) and the endpoints (to reject the request).
export function isRefundFeedbackComplete(
	reason: RefundReason | null | undefined,
	comments: string | null | undefined,
): reason is RefundReason {
	if (!reason) {
		return false;
	}
	return !refundCommentsRequired(reason) || (comments ?? "").trim().length > 0;
}
