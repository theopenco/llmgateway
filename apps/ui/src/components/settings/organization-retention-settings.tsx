"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import * as React from "react";
import { useState } from "react";

import { Alert, AlertDescription } from "@/lib/components/alert";
import { Button } from "@/lib/components/button";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Separator } from "@/lib/components/separator";
import { toast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";

export function OrganizationRetentionSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardState();

	const api = useApi();
	const updateOrganization = api.useMutation("patch", "/orgs/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs").queryKey;
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const [retentionLevel, setRetentionLevel] = useState<"retain" | "none">(
		selectedOrganization?.retentionLevel || "retain",
	);

	// Fetch projects to check if any have caching enabled
	const { data: projectsData } = api.useQuery("get", "/orgs/{id}/projects", {
		params: { path: { id: selectedOrganization?.id || "" } },
		enabled: !!selectedOrganization?.id,
	});

	const projectsWithCaching =
		projectsData?.projects?.filter((project) => project.cachingEnabled) || [];
	const hasCachingEnabled = projectsWithCaching.length > 0;

	if (!selectedOrganization) {
		return (
			<div className="space-y-2">
				<h3 className="text-lg font-medium">Data Retention</h3>
				<p className="text-muted-foreground text-sm">
					Please select an organization to configure data retention settings.
				</p>
			</div>
		);
	}

	const updateProject = api.useMutation("patch", "/projects/{id}");

	const handleSave = async () => {
		try {
			// Update organization retention level
			await updateOrganization.mutateAsync({
				params: { path: { id: selectedOrganization.id } },
				body: { retentionLevel },
			});

			// If switching to metadata-only and there are projects with caching enabled,
			// disable caching for all those projects
			if (retentionLevel === "none" && hasCachingEnabled) {
				for (const project of projectsWithCaching) {
					await updateProject.mutateAsync({
						params: { path: { id: project.id } },
						body: { cachingEnabled: false },
					});
				}
			}

			toast({
				title: "Settings saved",
				description:
					retentionLevel === "none" && hasCachingEnabled
						? `Data retention settings updated. Caching disabled for ${projectsWithCaching.length} project${projectsWithCaching.length > 1 ? "s" : ""}.`
						: "Your data retention settings have been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save data retention settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Data Retention</h3>
				<p className="text-muted-foreground text-sm">
					Configure how request payloads and AI responses are stored
				</p>
				{selectedOrganization && (
					<p className="text-muted-foreground text-sm mt-1">
						Organization: {selectedOrganization.name}
					</p>
				)}
			</div>

			<Separator />

			<div className="space-y-4">
				{retentionLevel === "none" && hasCachingEnabled && (
					<Alert>
						<AlertDescription>
							⚠️ {projectsWithCaching.length} project
							{projectsWithCaching.length > 1 ? "s" : ""} currently have caching
							enabled. Switching to metadata-only retention will disable caching
							for all projects.
						</AlertDescription>
					</Alert>
				)}

				<RadioGroup
					value={retentionLevel}
					onValueChange={(value: "retain" | "none") => setRetentionLevel(value)}
					className="space-y-2"
				>
					{[
						{
							id: "retain",
							label: "Retain All Data",
							desc: "Save request payloads and AI responses along with metadata",
						},
						{
							id: "none",
							label: "Metadata Only",
							desc: "Save only metadata, pricing, and usage data (exclude request payloads and responses)",
						},
					].map(({ id, label, desc }) => (
						<div key={id} className="flex items-start space-x-2">
							<RadioGroupItem value={id} id={id} />
							<div className="space-y-1 flex-1">
								<Label htmlFor={id} className="font-medium">
									{label}
								</Label>
								<p className="text-sm text-muted-foreground">{desc}</p>
							</div>
						</div>
					))}
				</RadioGroup>

				{retentionLevel === "retain" && (
					<>
						<Alert>
							<AlertDescription>
								<strong>Data Retention Period:</strong> Retained data is
								automatically cleaned up after 30 days. Contact us for
								enterprise plans with unlimited retention.
								<p className="mt-2">
									<strong>Data storage is billed at $0.01 per 1M tokens</strong>{" "}
									(includes input, cached, output, and reasoning tokens).
								</p>
							</AlertDescription>
						</Alert>
						<Alert>
							<AlertDescription>
								<p>
									<strong>💡 Tip:</strong> Storage costs are deducted from
									credits in real-time. We recommend enabling auto top-up in{" "}
									<Link
										href={`/dashboard/${selectedOrganization?.id}/org/billing`}
										className="underline font-semibold hover:no-underline"
									>
										billing settings
									</Link>{" "}
									to prevent request failures when credits run out.
								</p>
							</AlertDescription>
						</Alert>
					</>
				)}
			</div>

			<div className="flex justify-end">
				<Button onClick={handleSave} disabled={updateOrganization.isPending}>
					{updateOrganization.isPending ? "Saving..." : "Save Settings"}
				</Button>
			</div>
		</div>
	);
}
