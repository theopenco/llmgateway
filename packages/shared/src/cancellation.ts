// Reasons collected by the DevPass cancel flow and the post-cancel feedback
// page. Shared so the dialog, the API validation and the database enum stay
// in sync.

export const DEV_PLAN_CANCELLATION_REASONS = [
	"too_expensive",
	"not_using_enough",
	"allowance_too_small",
	"tool_not_supported",
	"missing_features",
	"switched_alternative",
	"just_testing",
	"other",
] as const;

export type DevPlanCancellationReason =
	(typeof DEV_PLAN_CANCELLATION_REASONS)[number];

// Matches the refund feedback limit so both datasets are comparable.
export const DEV_PLAN_CANCELLATION_COMMENTS_MAX_LENGTH = 2000;

export interface DevPlanCancellationReasonOption {
	value: DevPlanCancellationReason;
	label: string;
	// Follow-up question revealed once this reason is picked.
	prompt: string;
	placeholder: string;
}

// Ordered by how often each reason is picked; review quarterly.
export const DEV_PLAN_CANCELLATION_REASON_OPTIONS: readonly DevPlanCancellationReasonOption[] =
	[
		{
			value: "too_expensive",
			label: "Too expensive",
			prompt: "What would have been worth paying for?",
			placeholder: "A price, a plan, or what would have justified it.",
		},
		{
			value: "not_using_enough",
			label: "Not using it enough",
			prompt: "What got in the way?",
			placeholder: "Less coding than expected, a different workflow, no time?",
		},
		{
			value: "allowance_too_small",
			label: "Ran through my allowance too fast",
			prompt: "What were you running?",
			placeholder:
				"Which models and tools, and how far into the cycle it ran out.",
		},
		{
			value: "tool_not_supported",
			label: "My coding tool isn't supported",
			prompt: "Which tool?",
			placeholder: "The editor, agent or CLI you wanted to use.",
		},
		{
			value: "missing_features",
			label: "Missing a model or feature",
			prompt: "What was missing?",
			placeholder: "The model, feature or limit you needed and couldn't get.",
		},
		{
			value: "switched_alternative",
			label: "Went with something else",
			prompt: "What are you using instead?",
			placeholder: "And what does it do better than us?",
		},
		{
			value: "just_testing",
			label: "I was only trying it out",
			prompt: "What would have kept you?",
			placeholder: "Anything that fell short of what you expected.",
		},
		{
			value: "other",
			label: "Something else",
			prompt: "What happened?",
			placeholder: "In your own words.",
		},
	];

export const DEV_PLAN_CANCELLATION_HEADING =
	"Help us improve — what's the main reason?";

// "Something else" carries no signal on its own, so the details are required
// there and optional everywhere else.
export function cancellationCommentsRequired(
	reason: DevPlanCancellationReason,
): boolean {
	return reason === "other";
}
