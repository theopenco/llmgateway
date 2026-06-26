"use client";

import { Plus } from "lucide-react";

import { CreateProviderKeyDialog } from "@/components/provider-keys/create-provider-key-dialog";
import { CreditsRecommendationBanner } from "@/components/provider-keys/credits-recommendation-banner";
import { ProviderKeysList } from "@/components/provider-keys/provider-keys-list";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";

import type { ProviderKeyOptions } from "@llmgateway/db";

interface ProviderKeysClientProps {
	initialProviderKeysData?: {
		providerKeys: {
			id: string;
			createdAt: string;
			updatedAt: string;
			provider: string;
			name: string | null;
			baseUrl: string | null;
			options: ProviderKeyOptions | null;
			status: "active" | "inactive" | "deleted" | null;
			customModelsOnly: boolean;
			organizationId: string;
			maskedToken: string;
		}[];
	};
}

export function ProviderKeysClient({
	initialProviderKeysData,
}: ProviderKeysClientProps) {
	const { selectedOrganization } = useDashboardNavigation();

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<h2 className="text-2xl font-bold tracking-tight">Provider Keys</h2>
						<p className="max-w-2xl text-sm text-muted-foreground">
							Bring your own provider API keys to use them through LLM Gateway
							without additional fees.
						</p>
					</div>
					{selectedOrganization && (
						<CreateProviderKeyDialog
							selectedOrganization={selectedOrganization}
						>
							<Button className="w-full sm:w-auto">
								<Plus className="mr-2 h-4 w-4" />
								Add Provider Key
							</Button>
						</CreateProviderKeyDialog>
					)}
				</div>
				<CreditsRecommendationBanner />
				<ProviderKeysList
					selectedOrganization={selectedOrganization}
					initialData={initialProviderKeysData}
				/>
			</div>
		</div>
	);
}
