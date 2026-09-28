import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { models, type ModelDefinition } from "@llmgateway/models";
import {
	SMART_ROUTING_CLASSIFIERS,
	SMART_ROUTING_MAX_MODELS,
	isSmartRoutingSelectableModel,
	type SmartRoutingConfig,
} from "@llmgateway/shared/smart-routing";

/**
 * Model ids auto routing may be pointed at: catalogue models that can emit
 * text and still have a mapping that serves requests, excluding the routing
 * pseudo-models themselves. Aliases map to their canonical id so a stored
 * config never depends on an alias moving.
 */
const smartRoutingModelByRef = new Map<string, ModelDefinition>();
for (const model of models) {
	const definition = model as ModelDefinition;
	smartRoutingModelByRef.set(definition.id, definition);
	for (const alias of ("aliases" in model
		? ((model.aliases as readonly string[] | undefined) ?? [])
		: []) as readonly string[]) {
		smartRoutingModelByRef.set(alias, definition);
	}
}

/**
 * Liveness is checked per call rather than baked into a module-scope list: a
 * mapping's `deactivatedAt` is usually a future date when the code ships, so a
 * snapshot taken at import would keep accepting the model after it retired.
 */
function resolveSmartRoutingModelId(ref: string): string | undefined {
	const model = smartRoutingModelByRef.get(ref);
	return model && isSmartRoutingSelectableModel(model) ? model.id : undefined;
}

export const smartRoutingConfigInputSchema = z.object({
	classifier: z.enum(SMART_ROUTING_CLASSIFIERS),
	models: z
		.array(
			z
				.string()
				.max(256)
				.refine((ref) => resolveSmartRoutingModelId(ref) !== undefined, {
					message: "Unknown, non-text, or retired model",
				}),
		)
		.min(1)
		.max(SMART_ROUTING_MAX_MODELS),
	fallbackModel: z.string().max(256).optional(),
});

/**
 * Normalize a submitted config for storage: aliases become canonical ids and
 * duplicates collapse, so two refs for the same model cannot occupy two slots
 * of the price-band split the gateway computes from this list.
 */
export function normalizeSmartRoutingConfig(
	config: z.infer<typeof smartRoutingConfigInputSchema> | null,
): SmartRoutingConfig | null {
	if (!config) {
		return null;
	}
	const modelIds = Array.from(
		new Set(config.models.map((ref) => resolveSmartRoutingModelId(ref)!)),
	);
	if (modelIds.length === 0) {
		throw new HTTPException(400, {
			message: "Auto routing requires at least one model",
		});
	}
	// Only the classifier can fail to give a verdict; without one the cheapest
	// model always serves the request.
	if (!config.fallbackModel || config.classifier !== "jev") {
		return { classifier: config.classifier, models: modelIds };
	}
	const fallbackModel = resolveSmartRoutingModelId(config.fallbackModel);
	if (!fallbackModel || !modelIds.includes(fallbackModel)) {
		throw new HTTPException(400, {
			message: "The fallback model must be one of the configured models",
		});
	}
	return { classifier: config.classifier, models: modelIds, fallbackModel };
}
