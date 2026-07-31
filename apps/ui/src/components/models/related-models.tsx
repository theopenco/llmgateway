import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { perMillion } from "@/lib/discount";

import {
	models as modelDefinitions,
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

const RELATED_MODELS_LIMIT = 6;

function activeMappings(model: ModelDefinition) {
	return model.providers.filter((p) => !isMappingDeactivated(p));
}

function startingPrice(
	model: ModelDefinition,
	field: "inputPrice" | "outputPrice",
): number | null {
	const prices = activeMappings(model)
		.map((p) => perMillion(p[field]))
		.filter((n): n is number => n !== null && Number.isFinite(n));
	return prices.length > 0 ? Math.min(...prices) : null;
}

// Internal-linking block: other active models from the same family, newest
// first, computed straight from the catalogue at render time.
export function RelatedModels({ modelDef }: { modelDef: ModelDefinition }) {
	const related = (modelDefinitions as readonly ModelDefinition[])
		.filter(
			(m) =>
				m.family === modelDef.family &&
				m.id !== modelDef.id &&
				activeMappings(m).length > 0,
		)
		.sort(
			(a, b) => (b.releasedAt?.getTime() ?? 0) - (a.releasedAt?.getTime() ?? 0),
		)
		.slice(0, RELATED_MODELS_LIMIT);

	if (related.length === 0) {
		return null;
	}

	// Families usually match a provider id (e.g. "openai"), whose display name
	// reads better than a bare capitalization of the family slug.
	const familyLabel =
		providerDefinitions.find((p) => p.id === modelDef.family)?.name ??
		modelDef.family.charAt(0).toUpperCase() + modelDef.family.slice(1);

	return (
		<div>
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-xl md:text-2xl font-semibold">
					More {familyLabel} models
				</h2>
				<Link
					href="/models"
					className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
				>
					Browse all models
					<ArrowUpRight className="h-3.5 w-3.5" />
				</Link>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{related.map((model) => {
					const maxContext = Math.max(
						...activeMappings(model).map((p) => p.contextSize ?? 0),
					);
					const minInput = startingPrice(model, "inputPrice");
					const minOutput = startingPrice(model, "outputPrice");
					return (
						<Link
							key={model.id}
							href={`/models/${encodeURIComponent(model.id)}`}
							className="group rounded-lg border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40"
						>
							<p className="font-medium truncate group-hover:underline group-hover:underline-offset-4">
								{model.name ?? model.id}
							</p>
							<p className="mt-2 text-xs text-muted-foreground space-x-2">
								{maxContext > 0 && (
									<span>{maxContext.toLocaleString()} context</span>
								)}
								{model.free ? (
									<span>Free</span>
								) : (
									minInput !== null &&
									minOutput !== null && (
										<span>
											${minInput.toFixed(2)} in / ${minOutput.toFixed(2)} out
											per 1M
										</span>
									)
								)}
							</p>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
