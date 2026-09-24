import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { models, type ModelDefinition } from "@llmgateway/models";
import {
	AUTO_ROUTING_CLASSIFIERS,
	AUTO_ROUTING_MAX_MODELS,
	type AutoRoutingConfig,
} from "@llmgateway/shared/auto-routing";

/**
 * Model ids auto routing may be pointed at: catalogue models that can emit
 * text, excluding the routing pseudo-models themselves. Aliases map to their
 * canonical id so a stored config never depends on an alias moving.
 */
const autoRoutingModelIdByRef = new Map<string, string>();
for (const model of models) {
	if (model.id === "auto" || model.id === "custom") {
		continue;
	}
	const output = (model as ModelDefinition).output;
	if (output && !output.includes("text")) {
		continue;
	}
	autoRoutingModelIdByRef.set(model.id, model.id);
	for (const alias of ("aliases" in model
		? ((model.aliases as readonly string[] | undefined) ?? [])
		: []) as readonly string[]) {
		autoRoutingModelIdByRef.set(alias, model.id);
	}
}

export const AUTO_ROUTING_MODEL_IDS = Array.from(
	new Set(autoRoutingModelIdByRef.values()),
);

export const autoRoutingConfigInputSchema = z.object({
	classifier: z.enum(AUTO_ROUTING_CLASSIFIERS),
	models: z
		.array(
			z
				.string()
				.max(256)
				.refine((ref) => autoRoutingModelIdByRef.has(ref), {
					message: "Unknown or non-text model",
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
		new Set(config.models.map((ref) => autoRoutingModelIdByRef.get(ref)!)),
	);
	if (modelIds.length === 0) {
		throw new HTTPException(400, {
			message: "Auto routing requires at least one model",
		});
	}
	return { classifier: config.classifier, models: modelIds };
}
