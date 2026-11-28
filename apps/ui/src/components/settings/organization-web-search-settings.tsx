"use client";
import { useEffect, useState } from "react";

import { useUpdateOrganization } from "@/hooks/useOrganization";
import { Button } from "@/lib/components/button";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { toast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";

import {
	DEFAULT_GATEWAY_WEB_SEARCH_ENGINE,
	GATEWAY_WEB_SEARCH_ENGINE_IDS,
	GATEWAY_WEB_SEARCH_ENGINES,
	type GatewayWebSearchEngine,
	getWebSearchEngineComplianceFailures,
	getWebSearchEngineDataPolicy,
	resolveGatewayWebSearchEngine,
} from "@llmgateway/models";

const ENGINE_DESCRIPTIONS: Record<GatewayWebSearchEngine, string> = {
	perplexity: "Perplexity Search API: ranked web results with page excerpts.",
	exa: "Exa search: neural web search with page highlights.",
};

function describeDataHandling(engine: GatewayWebSearchEngine): string {
	const { dataPolicy } = getWebSearchEngineDataPolicy(engine);
	const training =
		dataPolicy?.apiTraining === false
			? "Does not train on queries"
			: "May use queries for model training";
	const retention =
		dataPolicy?.promptLogging === false &&
		dataPolicy.retentionPeriod === "0 days"
			? "zero data retention"
			: "may retain queries";
	return `${training}; ${retention}.`;
}

function formatPricePer1k(price: string): string {
	return `$${(Number(price) * 1000).toFixed(2)} per 1,000 searches`;
}

export function OrganizationWebSearchSettings() {
	const { selectedOrganization } = useDashboardState();
	const updateOrganization = useUpdateOrganization();

	const savedEngine = resolveGatewayWebSearchEngine(
		selectedOrganization?.webSearchEngine,
	);
	const [engine, setEngine] = useState<GatewayWebSearchEngine>(savedEngine);
	useEffect(() => {
		setEngine(savedEngine);
	}, [selectedOrganization?.id, savedEngine]);

	if (!selectedOrganization) {
		return null;
	}

	const isOwner = selectedOrganization.role === "owner";
	const compliancePolicy = selectedOrganization.providerCompliancePolicy;
	const blockedByPolicy = (id: GatewayWebSearchEngine) =>
		compliancePolicy?.enabled === true &&
		getWebSearchEngineComplianceFailures(id, compliancePolicy).length > 0;

	const handleSave = async () => {
		try {
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: { webSearchEngine: engine },
			});
			toast({
				title: "Settings saved",
				description: "Your web search engine has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save the web search engine.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<p className="text-sm text-muted-foreground">
				Used only when a request asks for web search and the provider serving it
				does not support web search natively. Providers with native web search
				always use their own. The engine receives your latest user message and
				must meet your compliance policy, like a provider.
				{!isOwner && " Only organization owners can change the engine."}
			</p>
			<RadioGroup
				value={engine}
				onValueChange={(value: GatewayWebSearchEngine) => setEngine(value)}
				disabled={!isOwner}
				className="space-y-2"
			>
				{GATEWAY_WEB_SEARCH_ENGINE_IDS.map((id) => (
					<div key={id} className="flex items-start space-x-2">
						<RadioGroupItem value={id} id={`web-search-${id}`} />
						<div className="flex-1 space-y-1">
							<Label htmlFor={`web-search-${id}`} className="font-medium">
								{GATEWAY_WEB_SEARCH_ENGINES[id].name}
								{id === DEFAULT_GATEWAY_WEB_SEARCH_ENGINE && " (default)"}
							</Label>
							<p className="text-sm text-muted-foreground">
								{ENGINE_DESCRIPTIONS[id]}{" "}
								{formatPricePer1k(GATEWAY_WEB_SEARCH_ENGINES[id].price)}.{" "}
								{describeDataHandling(id)}
							</p>
							{blockedByPolicy(id) && (
								<p className="text-sm text-destructive">
									Blocked by your organization's compliance policy: searches
									with this engine are skipped. API key policies apply too.
								</p>
							)}
						</div>
					</div>
				))}
			</RadioGroup>
			<div className="flex justify-end">
				<Button
					onClick={handleSave}
					disabled={
						!isOwner || updateOrganization.isPending || engine === savedEngine
					}
				>
					{updateOrganization.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
