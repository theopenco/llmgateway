import { models } from "./models.js";
import { getProviderDefinition } from "./providers.js";

/**
 * Human-friendly labels for model families. A family slug usually matches a
 * provider id, but some families (google, meta, …) do not, so keep an explicit
 * map and fall back to the provider definition, then the slug.
 */
const MODEL_FAMILY_LABELS: Record<string, string> = {
	alibaba: "Alibaba",
	anthropic: "Anthropic",
	atlascloud: "AtlasCloud",
	"black-forest-labs": "Black Forest Labs",
	bytedance: "ByteDance",
	deepseek: "DeepSeek",
	elevenlabs: "ElevenLabs",
	google: "Google",
	llmgateway: "LLM Gateway",
	meta: "Meta",
	minimax: "MiniMax",
	mistral: "Mistral",
	moonshot: "Moonshot AI",
	nvidia: "NVIDIA",
	openai: "OpenAI",
	perplexity: "Perplexity",
	reve: "Reve",
	sakana: "Sakana AI",
	xai: "xAI",
	xiaomi: "Xiaomi",
	zai: "Z.AI",
};

export function modelFamilyLabel(family: string): string {
	const known = MODEL_FAMILY_LABELS[family];
	if (known) {
		return known;
	}
	const definition = getProviderDefinition(family);
	if (definition?.name) {
		return definition.name;
	}
	return family.charAt(0).toUpperCase() + family.slice(1);
}

/** Every family present in the catalogue, de-duplicated and label-sorted. */
export const modelFamilies: { id: string; label: string }[] = [
	...new Set(models.map((model) => model.family as string)),
]
	.map((id) => ({ id, label: modelFamilyLabel(id) }))
	.sort((a, b) => a.label.localeCompare(b.label));

const familyByModelId = new Map<string, string>(
	models.map((model) => [model.id as string, model.family as string]),
);

/** Family of a catalogue model id; null when the id is not in the catalogue. */
export function getModelFamily(modelId: string): string | null {
	return familyByModelId.get(modelId) ?? null;
}

/**
 * Strips the provider prefix and variant suffix off a logged `usedModel`
 * ("aws-bedrock/claude-5:thinking" -> "claude-5"). Mirrors the canonical model
 * view the stats API derives in SQL.
 */
export function canonicalUsedModelId(usedModel: string): string {
	const slash = usedModel.indexOf("/");
	const withoutProvider = slash === -1 ? usedModel : usedModel.slice(slash + 1);
	return withoutProvider.split(":")[0];
}

/**
 * Family behind a logged `usedModel` ("anthropic/claude-5",
 * "aws-bedrock/claude-5") or a bare canonical id, regardless of which provider
 * served it. Null when no catalogue model matches.
 */
export function resolveUsedModelFamily(usedModel: string): string | null {
	return getModelFamily(canonicalUsedModelId(usedModel));
}
