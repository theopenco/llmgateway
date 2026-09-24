"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { AutoRoutingSettings } from "@/components/settings/auto-routing-settings";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { AutoRoutingConfig } from "@llmgateway/shared/auto-routing";

export function AutoRoutingCard({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardNavigation();
	const { data } = api.useQuery("get", "/projects/{id}", {
		params: { path: { id: projectId } },
	});

	const updateProject = api.useMutation("patch", "/projects/{id}", {
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/orgs/{id}/projects", {
					params: { path: { id: orgId } },
				}).queryKey,
			});
			void queryClient.invalidateQueries({
				queryKey: api.queryOptions("get", "/projects/{id}", {
					params: { path: { id: projectId } },
				}).queryKey,
			});
		},
	});

	const savedOverride =
		(data?.project.autoRoutingConfig as AutoRoutingConfig | null) ?? null;
	const inherited =
		(selectedOrganization?.autoRoutingConfig as AutoRoutingConfig | null) ??
		null;

	const [overrideEnabled, setOverrideEnabled] = useState(
		savedOverride !== null,
	);
	useEffect(() => {
		setOverrideEnabled(savedOverride !== null);
	}, [savedOverride]);

	const save = async (config: AutoRoutingConfig | null) => {
		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: { autoRoutingConfig: config },
			});
			toast({
				title: "Settings saved",
				description: config
					? "This project now overrides the organization's auto routing."
					: "This project inherits the organization's auto routing again.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save auto routing settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>Auto Routing</CardTitle>
				<CardDescription>
					Choose which models the <code className="text-xs">auto</code> model
					may resolve to for this project.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="flex items-center justify-between gap-4">
					<div className="space-y-0.5">
						<Label htmlFor="auto-routing-override">
							Override for this project
						</Label>
						<p className="text-muted-foreground text-sm">
							{inherited
								? `Inheriting the organization default (${inherited.models.length} model${inherited.models.length === 1 ? "" : "s"}, ${inherited.classifier} classifier).`
								: "The organization has no default configured, so the built-in models are used."}
						</p>
					</div>
					<Switch
						id="auto-routing-override"
						checked={overrideEnabled}
						disabled={updateProject.isPending}
						onCheckedChange={(checked) => {
							setOverrideEnabled(checked);
							if (!checked && savedOverride) {
								void save(null);
							}
						}}
					/>
				</div>

				{overrideEnabled ? (
					<AutoRoutingSettings
						value={savedOverride ?? inherited}
						canManage
						isSaving={updateProject.isPending}
						onSave={save}
					/>
				) : null}

				{!overrideEnabled && savedOverride ? (
					<div className="flex justify-end">
						<Button
							variant="ghost"
							disabled={updateProject.isPending}
							onClick={() => void save(null)}
						>
							Clear override
						</Button>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
