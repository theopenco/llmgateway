"use client";

import { models } from "@llmgateway/models";

import { Badge } from "@/lib/components/badge";
import { Card } from "@/lib/components/card";
import { formatContextSize } from "@/lib/utils";

import type { ModelDefinition } from "@llmgateway/models";

export function ModelsList() {
	return (
		<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
			{(models as readonly ModelDefinition[]).map((model) => (
				<Card key={model.id} className="p-4">
					<div className="text-lg font-semibold">{model.name || model.id}</div>
					<div className="text-sm text-muted-foreground mb-2">Providers:</div>
					<div className="flex flex-wrap gap-2 mb-2">
						{model.providers.map((provider) => (
							<Badge key={provider.providerId}>{provider.providerId}</Badge>
						))}
					</div>
					<div className="text-sm">
						{model.providers.map((provider) => (
							<div key={provider.providerId} className="mt-2">
								<div className="font-medium">{provider.providerId}:</div>
								{provider.contextSize && (
									<div>Context: {formatContextSize(provider.contextSize)}</div>
								)}
								{provider.inputPrice !== undefined && (
									<div>
										Input: ${(provider.inputPrice * 1e6).toFixed(2)} / M tokens
									</div>
								)}
								{provider.outputPrice !== undefined && (
									<div>
										Output: ${(provider.outputPrice * 1e6).toFixed(2)} / M
										tokens
									</div>
								)}
								{provider.imageInputPrice !== undefined && (
									<div>
										Image: ${provider.imageInputPrice.toFixed(5)} / input
									</div>
								)}
								{provider.requestPrice !== undefined && (
									<div>
										Request: ${(provider.requestPrice * 1000).toFixed(2)} / 1K
										requests
									</div>
								)}
							</div>
						))}
					</div>
				</Card>
			))}
		</div>
	);
}
