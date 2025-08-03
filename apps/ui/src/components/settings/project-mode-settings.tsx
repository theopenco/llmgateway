"use client";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Separator } from "@/lib/components/separator";
import { useToast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function ProjectModeSettings() {
	const config = useAppConfig();
	const { toast } = useToast();
	const { selectedProject, selectedOrganization } = useDashboardState();
	const queryClient = useQueryClient();

	const api = useApi();
	const updateProject = api.useMutation("patch", "/projects/{id}", {
		onSuccess: (data) => {
			if (selectedOrganization) {
				const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
					params: { path: { id: data.project.organizationId } },
				}).queryKey;
				queryClient.invalidateQueries({ queryKey });
			}
		},
	});

	const [mode, setMode] = useState<"api-keys" | "credits" | "hybrid">(
		selectedProject?.mode || "api-keys",
	);

	const isProPlan = selectedOrganization?.plan === "pro";

	if (!selectedProject) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Project Mode</h3>
				<p className="text-muted-foreground text-sm">
					Please select a project to configure mode settings.
				</p>
			</div>
		);
	}

	const handleSave = async () => {
		// Check if trying to set api-keys or hybrid mode without pro plan (only if paid mode is enabled)
		if (
			(mode === "api-keys" || mode === "hybrid") &&
			config.hosted &&
			!isProPlan
		) {
			toast({
				title: "Upgrade Required",
				description:
					"Provider keys are only available on the Pro plan. Please upgrade to use API keys mode.",
				variant: "destructive",
			});
			return;
		}

		try {
			await updateProject.mutateAsync({
				params: { path: { id: selectedProject.id } },
				body: { mode },
			});

			toast({
				title: "Settings saved",
				description: "Your project mode settings have been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save project mode settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Project Mode</h3>
				<p className="text-muted-foreground text-sm">
					Configure how your project consumes LLM services
				</p>
				{selectedProject && (
					<p className="text-muted-foreground text-sm mt-1">
						Project: {selectedProject.name}
					</p>
				)}
			</div>

			<Separator />

			<div className="space-y-4">
				<RadioGroup
					value={mode}
					onValueChange={(value: "api-keys" | "credits" | "hybrid") =>
						setMode(value)
					}
					className="space-y-2"
				>
					{[
						{
							id: "api-keys",
							label: "API Keys",
							desc: "Use your own provider API keys (OpenAI, Anthropic, etc.)",
							requiresPro: true,
						},
						{
							id: "credits",
							label: "Credits",
							desc: "Use your organization credits and our internal API keys",
							requiresPro: false,
						},
						{
							id: "hybrid",
							label: "Hybrid",
							desc: "Use your own API keys when available, fall back to credits when needed",
							requiresPro: true,
						},
					].map(({ id, label, desc, requiresPro }) => (
						<div key={id} className="flex items-start space-x-2">
							<RadioGroupItem
								value={id}
								id={id}
								disabled={requiresPro && config.hosted && !isProPlan}
							/>
							<div className="space-y-1 flex-1">
								<div className="flex items-center gap-2">
									<Label
										htmlFor={id}
										className={`font-medium ${requiresPro && config.hosted && !isProPlan ? "text-muted-foreground" : ""}`}
									>
										{label}
									</Label>
									{requiresPro && config.hosted && !isProPlan && (
										<Badge variant="outline" className="text-xs">
											Pro Only
										</Badge>
									)}
								</div>
								<p
									className={`text-sm ${
										requiresPro && config.hosted && !isProPlan
											? "text-muted-foreground"
											: "text-muted-foreground"
									}`}
								>
									{desc}
								</p>
							</div>
						</div>
					))}
				</RadioGroup>
			</div>

			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateProject.isPending}>
					{updateProject.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
