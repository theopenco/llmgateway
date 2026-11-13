// Types and presets for the Lounge Decision Studio. The request and answer
// shapes mirror the gateway's OpenAI-compatible `/v1/decisions` endpoint
// (apps/gateway/src/decisions/decisions.ts); they are duplicated here so the
// client bundle doesn't depend on gateway code.

export type DecisionQuestionType = "predicate" | "choice" | "score";

export interface DecisionChoice {
	value: string;
	description?: string;
}

export interface DecisionLevel {
	label: string;
	description?: string;
}

export type DecisionQuestion =
	| { type: "predicate"; name: string; instructions: string }
	| {
			type: "choice";
			name: string;
			instructions: string;
			choices: DecisionChoice[];
	  }
	| {
			type: "score";
			name: string;
			instructions: string;
			levels: DecisionLevel[];
	  };

export interface DecisionProbability {
	value: string | boolean | number;
	label?: string;
	probability: number;
}

export interface DecisionAnswer {
	type: "predicate" | "choice" | "score" | "refusal";
	name?: string | null;
	probability?: number;
	choice?: string | boolean;
	score?: number;
	probabilities?: DecisionProbability[];
	confidence?: number;
}

export interface DecisionUsage {
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
}

export const DECISION_IMAGE_MEDIA_TYPES = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
] as const;

export type DecisionImageMediaType =
	(typeof DECISION_IMAGE_MEDIA_TYPES)[number];

export interface DecisionInputImage {
	dataUrl: string;
	mediaType: DecisionImageMediaType;
}

export interface DecisionModelResult {
	modelId: string;
	modelName: string;
	answers: DecisionAnswer[] | null;
	usage?: DecisionUsage | null;
	error?: string;
	isLoading: boolean;
}

export interface DecisionGalleryItem {
	id: string;
	// The evaluated text. Immutable once saved; renames go to `title`.
	prompt: string;
	title?: string | null;
	timestamp: number;
	// Organization context active when the run was started. Captured up front
	// so the saved item is attributed to the right org even if the user
	// switches organizations while the run is in flight.
	organizationId?: string;
	inputImages?: DecisionInputImage[];
	// Set on history list items, whose image payloads are fetched on demand.
	inputImageCount?: number;
	// True once the run has a history row; local placeholders are not.
	persisted?: boolean;
	questions: DecisionQuestion[];
	models: DecisionModelResult[];
}

export const MAX_DECISION_QUESTIONS = 10;
export const MAX_DECISION_CHOICES = 12;
export const MAX_DECISION_LEVELS = 10;
export const MAX_DECISION_INPUT_IMAGES = 4;
export const MAX_DECISION_MODELS = 3;
// Images are downscaled in the browser before they are attached, so a data
// URL over this length means the client-side resize was bypassed.
export const MAX_DECISION_IMAGE_DATA_URL_LENGTH = 2_000_000;
export const DECISION_IMAGE_DATA_URL_PATTERN =
	/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

export function isDecisionImageDataUrl(value: string): boolean {
	return (
		value.length <= MAX_DECISION_IMAGE_DATA_URL_LENGTH &&
		DECISION_IMAGE_DATA_URL_PATTERN.test(value)
	);
}

export const DECISION_QUESTION_TYPE_LABELS: Record<
	DecisionQuestionType,
	{ label: string; description: string }
> = {
	predicate: {
		label: "Yes / no",
		description: "Probability that a condition holds",
	},
	choice: {
		label: "Pick one",
		description: "One option from a set you define",
	},
	score: {
		label: "Rate",
		description: "A rating across ordered levels",
	},
};

export interface DecisionScenario {
	label: string;
	input: string;
	questions: DecisionQuestion[];
}

// Empty-state presets. Each one exercises at least two question types so the
// result view shows what the endpoint returns beyond a single probability.
export const decisionScenarios: readonly DecisionScenario[] = [
	{
		label: "Triage a support ticket",
		input:
			"Hi, I was charged twice for my order #48213 on the 14th and I still haven't received a refund. This is the third time I've written in. If this isn't resolved today I'm disputing the charge with my bank.",
		questions: [
			{
				type: "choice",
				name: "department",
				instructions: "Which team should handle this ticket?",
				choices: [
					{ value: "billing", description: "Payments, invoices, refunds" },
					{ value: "technical", description: "Bugs, outages, integrations" },
					{ value: "sales", description: "Pricing, plans, quotes" },
				],
			},
			{
				type: "predicate",
				name: "is_urgent",
				instructions: "Does the customer convey urgency or a deadline?",
			},
			{
				type: "score",
				name: "churn_risk",
				instructions: "How likely is this customer to leave?",
				levels: [
					{ label: "Low" },
					{ label: "Medium" },
					{ label: "High" },
					{ label: "Imminent" },
				],
			},
		],
	},
	{
		label: "Moderate a comment",
		input:
			"lol this update is garbage, whoever shipped it should be fired. anyway does anyone know how to roll back to the previous version? my whole team is blocked.",
		questions: [
			{
				type: "predicate",
				name: "violates_policy",
				instructions:
					"Does the comment contain harassment, hate speech or threats that violate a typical community policy?",
			},
			{
				type: "choice",
				name: "action",
				instructions: "What should a moderator do with this comment?",
				choices: [
					{ value: "approve", description: "Leave it as is" },
					{ value: "warn", description: "Keep it but warn the author" },
					{ value: "remove", description: "Hide the comment" },
				],
			},
			{
				type: "score",
				name: "toxicity",
				instructions: "Rate the tone of the comment.",
				levels: [
					{ label: "Civil" },
					{ label: "Blunt" },
					{ label: "Rude" },
					{ label: "Abusive" },
				],
			},
		],
	},
	{
		label: "Qualify a sales lead",
		input:
			"Hello, I'm the head of platform at a 400-person fintech. We're consolidating our LLM spend across six teams and need SSO, audit logs and a private deployment option. Looking to decide by end of quarter. Budget is approved.",
		questions: [
			{
				type: "score",
				name: "fit",
				instructions: "How well does this lead match an enterprise plan?",
				levels: [
					{ label: "Poor" },
					{ label: "Weak" },
					{ label: "Good" },
					{ label: "Excellent" },
				],
			},
			{
				type: "predicate",
				name: "has_budget",
				instructions: "Does the lead state that budget is available?",
			},
			{
				type: "choice",
				name: "next_step",
				instructions: "What is the best next step for sales?",
				choices: [
					{ value: "book_demo" },
					{ value: "send_pricing" },
					{ value: "nurture" },
					{ value: "disqualify" },
				],
			},
		],
	},
	{
		label: "Classify a product review",
		input:
			"Battery lasts two days which is great, but the strap broke after a week and support took ten days to answer. Mixed feelings. Would I buy it again? Probably not at this price.",
		questions: [
			{
				type: "score",
				name: "sentiment",
				instructions: "Rate the overall sentiment of the review.",
				levels: [
					{ label: "Very negative" },
					{ label: "Negative" },
					{ label: "Neutral" },
					{ label: "Positive" },
					{ label: "Very positive" },
				],
			},
			{
				type: "choice",
				name: "main_topic",
				instructions: "Which aspect does the reviewer complain about most?",
				choices: [
					{ value: "battery" },
					{ value: "build_quality" },
					{ value: "support" },
					{ value: "price" },
				],
			},
			{
				type: "predicate",
				name: "would_repurchase",
				instructions: "Would the reviewer buy the product again?",
			},
		],
	},
	{
		label: "Route a chat message",
		input:
			"Can you write me a Python script that downloads every PDF linked on a page and then summarize each one in two sentences?",
		questions: [
			{
				type: "choice",
				name: "model_tier",
				instructions:
					"Which model tier should serve this request at the lowest cost that still does the job well?",
				choices: [
					{ value: "small", description: "Fast, cheap, simple tasks" },
					{ value: "medium", description: "General coding and writing" },
					{ value: "frontier", description: "Hard reasoning, long outputs" },
				],
			},
			{
				type: "predicate",
				name: "needs_tools",
				instructions:
					"Does completing this request require running code or fetching web pages?",
			},
			{
				type: "score",
				name: "complexity",
				instructions: "Rate the complexity of the task.",
				levels: [
					{ label: "Trivial" },
					{ label: "Simple" },
					{ label: "Moderate" },
					{ label: "Complex" },
				],
			},
		],
	},
	{
		label: "Screen a job application",
		input:
			"Six years as a backend engineer, mostly Go and Postgres. Led the migration of a monolith into services at my last company (team of eight). Comfortable on call. No frontend experience and I've never used Kubernetes in production.",
		questions: [
			{
				type: "predicate",
				name: "meets_minimum",
				instructions:
					"Does the candidate meet a minimum bar of five years of backend experience?",
			},
			{
				type: "score",
				name: "seniority",
				instructions: "Estimate the candidate's seniority.",
				levels: [
					{ label: "Junior" },
					{ label: "Mid" },
					{ label: "Senior" },
					{ label: "Staff" },
				],
			},
			{
				type: "choice",
				name: "best_team",
				instructions: "Which team is the best fit?",
				choices: [
					{ value: "platform", description: "Infra, Kubernetes, reliability" },
					{ value: "backend", description: "Services, APIs, databases" },
					{ value: "fullstack", description: "Product features end to end" },
				],
			},
		],
	},
];

export function createDecisionQuestion(
	type: DecisionQuestionType,
): DecisionQuestion {
	switch (type) {
		case "predicate":
			return { type, name: "", instructions: "" };
		case "choice":
			return {
				type,
				name: "",
				instructions: "",
				choices: [{ value: "" }, { value: "" }],
			};
		case "score":
			return {
				type,
				name: "",
				instructions: "",
				levels: [{ label: "" }, { label: "" }],
			};
	}
}

// Keeps the fields the two types share when the user switches a question's
// type, so instructions typed before the switch are not lost.
export function convertDecisionQuestion(
	question: DecisionQuestion,
	type: DecisionQuestionType,
): DecisionQuestion {
	if (question.type === type) {
		return question;
	}
	const next = createDecisionQuestion(type);
	return { ...next, name: question.name, instructions: question.instructions };
}

/**
 * The first problem that would make the gateway reject the request, or null
 * when the questions are ready to send. Mirrors the server-side schema so the
 * studio can disable the run button instead of surfacing a 400.
 */
export function validateDecisionQuestions(
	questions: readonly DecisionQuestion[],
): string | null {
	if (questions.length === 0) {
		return "Add at least one question.";
	}
	if (questions.length > MAX_DECISION_QUESTIONS) {
		return `Ask at most ${MAX_DECISION_QUESTIONS} questions per run.`;
	}
	// Blank names are filled in on the wire (see normalizeDecisionQuestions),
	// so uniqueness is checked on the names that will actually be sent.
	const names = new Set<string>();
	for (let index = 0; index < questions.length; index++) {
		const question = questions[index]!;
		const position = `Question ${index + 1}`;
		if (!question.instructions.trim()) {
			return `${position} needs instructions.`;
		}
		const name = decisionQuestionName(question, index);
		if (names.has(name)) {
			return `${position}: the name "${name}" is used twice.`;
		}
		names.add(name);
		if (question.type === "choice") {
			const values = question.choices.map((choice) => choice.value.trim());
			if (values.length < 2 || values.some((value) => !value)) {
				return `${position} needs at least two named options.`;
			}
			if (values.length > MAX_DECISION_CHOICES) {
				return `${position} can have at most ${MAX_DECISION_CHOICES} options.`;
			}
			if (new Set(values).size !== values.length) {
				return `${position} has duplicate options.`;
			}
		}
		if (question.type === "score") {
			const labels = question.levels.map((level) => level.label.trim());
			if (labels.length < 2 || labels.some((label) => !label)) {
				return `${position} needs at least two labelled levels.`;
			}
			if (labels.length > MAX_DECISION_LEVELS) {
				return `${position} can have at most ${MAX_DECISION_LEVELS} levels.`;
			}
			if (new Set(labels).size !== labels.length) {
				return `${position} has duplicate levels.`;
			}
		}
	}
	return null;
}

/** The name sent on the wire: the user's, or `q<n>` when left blank. */
export function decisionQuestionName(
	question: Pick<DecisionQuestion, "name">,
	index: number,
): string {
	return question.name.trim() || `q${index + 1}`;
}

/** Trims every field and drops blank names and descriptions for the wire. */
export function normalizeDecisionQuestions(
	questions: readonly DecisionQuestion[],
): DecisionQuestion[] {
	return questions.map((question, index): DecisionQuestion => {
		const name = decisionQuestionName(question, index);
		const instructions = question.instructions.trim();
		switch (question.type) {
			case "predicate":
				return { type: "predicate", name, instructions };
			case "choice":
				return {
					type: "choice",
					name,
					instructions,
					choices: question.choices.map((choice) => ({
						value: choice.value.trim(),
						...(choice.description?.trim()
							? { description: choice.description.trim() }
							: {}),
					})),
				};
			default:
				return {
					type: "score",
					name,
					instructions,
					levels: question.levels.map((level) => ({
						label: level.label.trim(),
						...(level.description?.trim()
							? { description: level.description.trim() }
							: {}),
					})),
				};
		}
	});
}

export type DecisionInput =
	| string
	| {
			role: "user";
			content: (
				| { type: "input_text"; text: string }
				| { type: "input_image"; image_url: string }
			)[];
	  }[];

/**
 * A string for text-only runs; a user message with parts once images join.
 * The text part is left out when the run is images only.
 */
export function buildDecisionInput(
	text: string,
	images: readonly DecisionInputImage[],
): DecisionInput {
	if (images.length === 0) {
		return text;
	}
	return [
		{
			role: "user",
			content: [
				...(text.trim() ? [{ type: "input_text" as const, text }] : []),
				...images.map((image) => ({
					type: "input_image" as const,
					image_url: image.dataUrl,
				})),
			],
		},
	];
}

export function formatProbability(value: number): string {
	return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

/** The option or level the model favours, with its probability. */
export function topProbability(
	answer: DecisionAnswer,
): DecisionProbability | null {
	if (!answer.probabilities?.length) {
		return null;
	}
	return answer.probabilities.reduce((best, current) =>
		current.probability > best.probability ? current : best,
	);
}

/** Short headline for an answer: the value the code would branch on. */
export function decisionAnswerHeadline(
	answer: DecisionAnswer,
	question?: DecisionQuestion,
): string {
	switch (answer.type) {
		case "predicate":
			return answer.probability === undefined
				? "No answer"
				: `${formatProbability(answer.probability)} yes`;
		case "choice":
			return answer.choice === undefined ? "No answer" : String(answer.choice);
		case "score": {
			const top = topProbability(answer);
			const label =
				top?.label ??
				(question?.type === "score" && typeof top?.value === "number"
					? question.levels[top.value]?.label
					: undefined);
			if (label) {
				return label;
			}
			return answer.score === undefined ? "No answer" : answer.score.toFixed(2);
		}
		case "refusal":
			return "Refused";
	}
}
