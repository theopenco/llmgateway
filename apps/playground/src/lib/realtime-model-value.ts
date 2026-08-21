import type { ApiModel, ApiModelProviderMapping } from "@/lib/fetch-models";

/**
 * Split a ModelSelector value into its parts. Selecting "auto" yields a bare
 * model id, while pinning a provider yields "providerId/modelId" (with an
 * optional ":region" suffix). Both forms must resolve to the same catalogue
 * entry, or the caller cannot tell which provider will serve the session —
 * and realtime providers do not share a wire protocol.
 */
export function parseModelValue(value: string): {
	modelId: string;
	providerId: string | null;
} {
	const slashIdx = value.indexOf("/");
	if (slashIdx <= 0) {
		return { modelId: value, providerId: null };
	}
	const rest = value.slice(slashIdx + 1);
	const colonIdx = rest.indexOf(":");
	return {
		providerId: value.slice(0, slashIdx),
		modelId: colonIdx > 0 ? rest.slice(0, colonIdx) : rest,
	};
}

/**
 * Mapping that will serve a selector value: the pinned provider's mapping, or
 * the first offered one when the value carries no provider. Null when the
 * value names a model or provider that is not on offer.
 */
export function resolveSelectedMapping(
	models: ApiModel[],
	value: string,
): ApiModelProviderMapping | null {
	const { modelId, providerId } = parseModelValue(value);
	const model = models.find((m) => m.id === modelId);
	if (!model) {
		return null;
	}
	return providerId === null
		? (model.mappings[0] ?? null)
		: (model.mappings.find((m) => m.providerId === providerId) ?? null);
}

/** Whether a stored or URL-supplied selector value still resolves. */
export function isKnownModelValue(models: ApiModel[], value: string): boolean {
	return resolveSelectedMapping(models, value) !== null;
}
