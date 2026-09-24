import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { models, type ModelDefinition } from "@llmgateway/models";
import {
	AUTO_ROUTING_CLASSIFIERS,
	AUTO_ROUTING_MAX_MODELS,
	isAutoRoutingSelectableModel,
	type AutoRoutingConfig,
} from "@llmgateway/shared/auto-routing";

/**
 * Model ids auto routing may be pointed at: catalogue models that can emit
 * text and still have a mapping that serves requests, excluding the routing
 * pseudo-models themselves. Aliases map to their canonical id so a stored
 * config never depends on an alias moving.
 */
const autoRoutingModelByRef = new Map<string, ModelDefinition>();
for (const model of models) {
	const definition = model as ModelDefinition;
	autoRoutingModelByRef.set(definition.id, definition);
	for (const alias of ("aliases" in model
		? ((model.aliases as readonly string[] | undefined) ?? [])
		: []) as readonly string[]) {
		autoRoutingModelByRef.set(alias, definition);
	}
}

/**
 * Liveness is checked per call rather than baked into a module-scope list: a
 * mapping's `deactivatedAt` is usually a future date when the code ships, so a
 * snapshot taken at import would keep accepting the model after it retired.
 */
function resolveAutoRoutingModelId(ref: string): string | undefined {
	const model = autoRoutingModelByRef.get(ref);
	return model && isAutoRoutingSelectableModel(model) ? model.id : undefined;
}

export const autoRoutingConfigInputSchema = z.object({
	classifier: z.enum(AUTO_ROUTING_CLASSIFIERS),
	models: z
		.array(
			z
				.string()
				.max(256)
				.refine((ref) => resolveAutoRoutingModelId(ref) !== undefined, {
					message: "Unknown, non-text, or retired model",
				}),
		)
		.min(1)
		.max(AUTO_ROUTING_MAX_MODELS),
});

/**
 * Normalize a submitted config for storage: aliases become canonical ids and
 * duplicates collapse, so two refs for the same model cannot occupy two slots
 * of the price-band split the gateway computes from this list.
 */
export function normalizeAutoRoutingConfig(
	config: z.infer<typeof autoRoutingConfigInputSchema> | null,
): AutoRoutingConfig | null {
	if (!config) {
		return null;
	}
	const modelIds = Array.from(
		new Set(config.models.map((ref) => resolveAutoRoutingModelId(ref)!)),
	);
	if (modelIds.length === 0) {
		throw new HTTPException(400, {
			message: "Auto routing requires at least one model",
		});
	}
	return { classifier: config.classifier, models: modelIds };
}
