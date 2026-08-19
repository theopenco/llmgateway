/**
 * Canonical definition of a "coding model" — the set DevPass (dev-plan) orgs
 * are allowed to call.
 *
 * This is the single source of truth for BOTH the gateway's 403 gate and every
 * surface that lists coding models (the DevPass models directory, the coding
 * models showcase). They must not drift: a model the gateway accepts but the
 * directory hides reads to users as "DevPass has no access to this model".
 *
 * The shapes are intentionally structural so the same predicate works on
 * catalogue definitions from `@llmgateway/models` (optional fields, `undefined`
 * when unset) and on the JSON served by `GET /internal/models` (nullable
 * fields, `null`/`false` when unset).
 */

export interface CodingModelMapping {
	stability?: string | null;
	tools?: boolean | null;
	streaming?: boolean | "only" | null;
	cachedInputPrice?: string | null;
}

export interface CodingModel {
	free?: boolean | null;
	stability?: string | null;
	providers: readonly CodingModelMapping[];
}

/**
 * Prompt caching is the hard requirement for coding plans — the economics of a
 * flat-rate plan depend on it. A price of `"0"` still counts as supported.
 */
export function providerSupportsCachedInput(
	mapping: Pick<CodingModelMapping, "cachedInputPrice">,
): boolean {
	return (
		mapping.cachedInputPrice !== null && mapping.cachedInputPrice !== undefined
	);
}

/**
 * Whether a single provider mapping can serve coding-plan traffic: stable, with
 * tool calling, streaming, and cached input pricing.
 *
 * Deliberately does NOT require JSON output. Coding agents drive tool calls, not
 * `response_format`, and most Anthropic mappings only declare
 * `jsonOutputSchema`, so requiring it would exclude nearly the whole Claude
 * line from a plan that does in fact serve it.
 */
export function mappingSupportsCoding(mapping: CodingModelMapping): boolean {
	if (
		mapping.stability === "unstable" ||
		mapping.stability === "experimental"
	) {
		return false;
	}
	// `streaming` may be `"only"` (streaming-only deployments), which qualifies.
	return (
		mapping.tools === true &&
		mapping.streaming !== false &&
		providerSupportsCachedInput(mapping)
	);
}

/**
 * Whether a model qualifies for coding plans: paid, stable, and served by at
 * least one mapping that {@link mappingSupportsCoding}.
 */
export function isCodingModel(model: CodingModel): boolean {
	if (model.free) {
		return false;
	}
	if (model.stability === "unstable" || model.stability === "experimental") {
		return false;
	}
	return model.providers.some(mappingSupportsCoding);
}
