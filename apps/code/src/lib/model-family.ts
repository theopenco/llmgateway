import { models, type ModelDefinition } from "@llmgateway/models";

/**
 * Drop the provider prefix (everything before the first "/") and any
 * version/tag suffix (after ":") to recover the canonical model id, e.g.
 * "alibaba/qwen3.7-max:latest" -> "qwen3.7-max".
 */
export function canonicalModelId(usedModel: string): string {
	const slashIdx = usedModel.indexOf("/");
	const withoutProvider =
		slashIdx === -1 ? usedModel : usedModel.slice(slashIdx + 1);
	const colonIdx = withoutProvider.indexOf(":");
	return colonIdx === -1 ? withoutProvider : withoutProvider.slice(0, colonIdx);
}

const modelById = new Map<string, ModelDefinition>(
	(models as ModelDefinition[]).map((m) => [m.id, m]),
);

// A handful of model families don't share a name with a provider-icon key, so
// map them onto the closest brand logo. Everything else falls through to
// getProviderIcon, which already normalises and falls back to the LLM Gateway
// mark for unknown families.
const FAMILY_ICON_OVERRIDES: Record<string, string> = {
	google: "google-ai-studio",
	glm: "zai",
};

export interface CanonicalModel {
	/** Canonical model id, e.g. "qwen3.7-max". */
	id: string;
	/** Human-readable model name, falling back to the id. */
	name: string;
	/** Provider-icon key for the model's family (e.g. "alibaba"). */
	iconKey: string;
	/** Whether the model resolved to a known definition (has a public page). */
	known: boolean;
}

/**
 * Resolve a raw `usedModel` string to its canonical model, using the model's
 * family (creator) for the brand logo rather than the serving provider — so a
 * Qwen model routed through any provider still shows the Alibaba logo.
 */
export function resolveCanonicalModel(usedModel: string): CanonicalModel {
	const id = canonicalModelId(usedModel);
	const def = modelById.get(id);
	const family = def?.family;
	const iconKey = family
		? (FAMILY_ICON_OVERRIDES[family] ?? family)
		: usedModel;
	return {
		id,
		name: def?.name ?? id,
		iconKey,
		known: Boolean(def),
	};
}
