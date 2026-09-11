import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { applyDiscount, discountFraction, perMillion } from "@/lib/discount";
import { fetchModels, type ApiModel } from "@/lib/fetch-models";

import {
	providers as providerDefinitions,
	type ModelDefinition,
} from "@llmgateway/models";
import { isMappingDeactivated } from "@llmgateway/shared/components";

const RELATED_MODELS_LIMIT = 6;

function activeMappings(model: ApiModel) {
	return model.mappings.filter(
		(p) => p.status === "active" && !isMappingDeactivated(p),
	);
}

function startingPrice(
	model: ApiModel,
	field: "inputPrice" | "outputPrice",
): number | null {
	const prices = activeMappings(model)
		.map((p) => {
			const price = perMillion(p[field]);
			return price === null ? null : applyDiscount(price, p.discount);
		})
		.filter((n): n is number => n !== null && Number.isFinite(n));
	return prices.length > 0 ? Math.min(...prices) : null;
}

export async function RelatedModels({
	modelDef,
}: {
	modelDef: ModelDefinition;
}) {
	const related = (await fetchModels())
		.filter(
			(m) =>
				m.family === modelDef.family &&
				m.id !== modelDef.id &&
				m.status === "active" &&
				activeMappings(m).length > 0,
		)
		.sort(
			(a, b) =>
				new Date(b.releasedAt ?? b.createdAt).getTime() -
				new Date(a.releasedAt ?? a.createdAt).getTime(),
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
					const discount = Math.max(
						...activeMappings(model).map((p) => discountFraction(p.discount)),
					);
					return (
						<Link
							key={model.id}
							href={`/models/${encodeURIComponent(model.id)}`}
							className="group rounded-lg border border-border p-4 transition-colors hover:border-foreground/30 hover:bg-muted/40"
						>
							<p className="font-medium truncate group-hover:underline group-hover:underline-offset-4">
								{model.name ?? model.id}
							</p>
							{discount > 0 && (
								<Badge className="mt-2 bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20">
									Up to {Math.round(discount * 100)}% off
								</Badge>
							)}
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
