"use client";

import { Plus } from "lucide-react";

import { CreateProviderKeyDialog } from "@/components/provider-keys/create-provider-key-dialog";
import { ProviderKeysList } from "@/components/provider-keys/provider-keys-list";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";

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
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Provider Keys</h2>
						<p className="text-muted-foreground">
							Provider keys allow you to use your own API keys with LLM Gateway
							without additional fees.
						</p>
					</div>
					{selectedOrganization && (
						<CreateProviderKeyDialog
							selectedOrganization={selectedOrganization}
							existingProviderKeys={initialProviderKeysData?.providerKeys || []}
						>
							<Button>
								<Plus className="mr-2 h-4 w-4" />
								Add Provider Key
							</Button>
						</CreateProviderKeyDialog>
					)}
				</div>
				<div className="space-y-4">
					<Card>
						<CardContent>
							<ProviderKeysList
								selectedOrganization={selectedOrganization}
								initialData={initialProviderKeysData}
							/>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
