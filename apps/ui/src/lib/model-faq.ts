import { perMillion } from "@/lib/discount";

import type { ModelDefinition } from "@llmgateway/models";

export interface ModelFaq {
	question: string;
	answer: string;
}

interface FaqProviderInfo {
	providerId: string;
	providerInfo?: { name: string } | undefined;
	contextSize?: number | null;
	inputPrice?: string | number | null;
	outputPrice?: string | number | null;
	tools?: boolean | null;
	jsonOutput?: boolean | null;
	jsonOutputSchema?: boolean | null;
	vision?: boolean | null;
	reasoning?: boolean | null;
}

function formatReleaseDate(date: Date): string {
	// Release dates are declared as UTC midnights; formatting in the server's
	// local timezone would shift them to the previous day west of UTC.
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
		timeZone: "UTC",
	});
}

// Builds the FAQ shown on a model detail page (and its FAQPage JSON-LD)
// entirely from catalogue data, so answers never go stale relative to the
// pricing and capability tables rendered above them.
export function buildModelFaqs(
	modelDef: ModelDefinition,
	providers: FaqProviderInfo[],
): ModelFaq[] {
	const displayName = modelDef.name ?? modelDef.id;
	const faqs: ModelFaq[] = [];

	const providerNames = Array.from(
		new Set(providers.map((p) => p.providerInfo?.name ?? p.providerId)),
	);

	faqs.push({
		question: `What is ${displayName}?`,
		answer: `${
			modelDef.description ??
			`${displayName} is an AI model available through LLM Gateway.`
		} You can access it through LLM Gateway's OpenAI-compatible API with automatic provider routing, fallback, and cost analytics.`,
	});

	const inputPrices = providers
		.map((p) => perMillion(p.inputPrice))
		.filter((n): n is number => n !== null && Number.isFinite(n));
	const outputPrices = providers
		.map((p) => perMillion(p.outputPrice))
		.filter((n): n is number => n !== null && Number.isFinite(n));

	if (modelDef.free) {
		faqs.push({
			question: `How much does ${displayName} cost?`,
			answer: `${displayName} is currently free to use through LLM Gateway.`,
		});
	} else if (inputPrices.length > 0 && outputPrices.length > 0) {
		const minInput = Math.min(...inputPrices);
		const minOutput = Math.min(...outputPrices);
		faqs.push({
			question: `How much does ${displayName} cost?`,
			answer: `Pricing for ${displayName} on LLM Gateway starts at $${minInput.toFixed(2)} per million input tokens and $${minOutput.toFixed(2)} per million output tokens, depending on the provider. The pricing table above always reflects the current per-provider rates.`,
		});
	} else {
		faqs.push({
			question: `How much does ${displayName} cost?`,
			answer: `${displayName} uses non-token pricing (for example per request, per second, or per page). The provider cards above show the exact current rates for each provider.`,
		});
	}

	const maxContext = Math.max(...providers.map((p) => p.contextSize ?? 0));
	if (maxContext > 0) {
		faqs.push({
			question: `What is the context length of ${displayName}?`,
			answer: `${displayName} supports a context window of up to ${maxContext.toLocaleString()} tokens on its largest provider deployment.`,
		});
	}

	if (providerNames.length > 0) {
		faqs.push({
			question: `Which providers serve ${displayName}?`,
			answer: `${displayName} is served by ${providerNames.join(", ")} through LLM Gateway. Requests are automatically routed to the best available provider, with fallback when a provider has issues.`,
		});
	}

	const hasTools = providers.some((p) => p.tools);
	// STRICT ONLY: schema-enforced structured outputs. Soft jsonOutput
	// (response_format json_object / nudged) carries no schema guarantee and
	// must NOT be presented as structured outputs. The strict flag is
	// upstream-provider-dependent — the gateway never emulates schema
	// enforcement, so a mapping without jsonOutputSchema rejects json_schema.
	const hasStrictJson = providers.some((p) => p.jsonOutputSchema);
	const hasSoftJson = providers.some((p) => p.jsonOutput);
	faqs.push({
		question: `Does ${displayName} support tool calling and structured outputs?`,
		answer:
			hasTools && hasStrictJson
				? `Yes. ${displayName} supports both tool (function) calling and strict JSON output schema (upstream-enforced) through LLM Gateway.`
				: hasTools
					? hasSoftJson
						? `${displayName} supports tool (function) calling and soft JSON output, but NOT strict JSON output schema (its upstream provider does not enforce it).`
						: `${displayName} supports tool (function) calling, but not JSON output modes.`
					: hasStrictJson
						? `${displayName} supports strict JSON output schema, but not tool calling.`
						: hasSoftJson
							? `${displayName} supports soft JSON output, but not tool calling or strict JSON output schema.`
							: `No. ${displayName} does not currently support tool calling or structured JSON outputs through LLM Gateway.`,
	});

	if (modelDef.releasedAt) {
		faqs.push({
			question: `When was ${displayName} released?`,
			answer: `${displayName} was released on ${formatReleaseDate(modelDef.releasedAt)}.`,
		});
	}

	return faqs;
}

export function buildFaqSchema(faqs: ModelFaq[]) {
	return {
		"@context": "https://schema.org",
		"@type": "FAQPage",
		mainEntity: faqs.map((faq) => ({
			"@type": "Question",
			name: faq.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: faq.answer,
			},
		})),
	};
}
