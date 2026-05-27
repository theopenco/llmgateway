"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";

interface DevPlanSettingsProps {
	devPlanAllowAllModels: boolean;
	retentionLevel: "retain" | "none";
}

export default function DevPlanSettings({
	devPlanAllowAllModels: initialAllowAllModels,
	retentionLevel: initialRetentionLevel,
}: DevPlanSettingsProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [allowAllModels, setAllowAllModels] = useState(initialAllowAllModels);
	const [isUpdatingAllowAll, setIsUpdatingAllowAll] = useState(false);

	const [retainData, setRetainData] = useState(
		initialRetentionLevel === "retain",
	);
	const [isUpdatingRetention, setIsUpdatingRetention] = useState(false);

	const [advancedOpen, setAdvancedOpen] = useState(false);

	const updateSettingsMutation = api.useMutation(
		"patch",
		"/dev-plans/settings",
	);

	const invalidateStatus = () =>
		queryClient.invalidateQueries({
			predicate: (query) => {
				const key = query.queryKey;
				return Array.isArray(key) && key[1] === "/dev-plans/status";
			},
		});

	const handleAllowAllToggle = async (checked: boolean) => {
		setIsUpdatingAllowAll(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { devPlanAllowAllModels: checked },
			});
			setAllowAllModels(checked);
			toast.success(
				checked ? "All models enabled" : "Restricted to coding models",
			);
		} catch {
			toast.error("Failed to update settings");
		} finally {
			setIsUpdatingAllowAll(false);
		}
	};

	const handleRetentionToggle = async (checked: boolean) => {
		setIsUpdatingRetention(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { retentionLevel: checked ? "retain" : "none" },
			});
			setRetainData(checked);
			await invalidateStatus();
			toast.success(
				checked ? "Data retention enabled" : "Switched to metadata-only",
			);
		} catch {
			toast.error("Failed to update data retention");
		} finally {
			setIsUpdatingRetention(false);
		}
	};

	return (
		<div>
			<h2 className="mb-4 font-semibold">Settings</h2>
			<div className="space-y-4">
				<div className="rounded-xl border p-5 space-y-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<Label htmlFor="retain-data" className="text-sm font-medium">
								Retain request data
							</Label>
							<p className="text-xs text-muted-foreground">
								Store full request and response payloads for analytics and
								debugging. When off, only metadata is kept. Storage is billed,
								and this is only required when using the Responses API or for
								debugging purposes.
							</p>
						</div>
						<Switch
							id="retain-data"
							checked={retainData}
							onCheckedChange={handleRetentionToggle}
							disabled={isUpdatingRetention}
						/>
					</div>
				</div>

				<div className="rounded-xl border">
					<button
						type="button"
						onClick={() => setAdvancedOpen((open) => !open)}
						aria-expanded={advancedOpen}
						className="flex w-full items-center justify-between gap-4 p-5 text-left"
					>
						<span className="text-sm font-medium">Advanced</span>
						<ChevronDown
							className={`h-4 w-4 text-muted-foreground transition-transform ${
								advancedOpen ? "rotate-180" : ""
							}`}
						/>
					</button>

					{advancedOpen && (
						<div className="border-t p-5 space-y-4">
							<div className="flex items-center justify-between gap-4">
								<div className="space-y-0.5">
									<Label
										htmlFor="allow-all-models"
										className="text-sm font-medium"
									>
										Allow all models
									</Label>
									<p className="text-xs text-muted-foreground">
										Enable access beyond the curated coding model list
									</p>
								</div>
								<Switch
									id="allow-all-models"
									checked={allowAllModels}
									onCheckedChange={handleAllowAllToggle}
									disabled={isUpdatingAllowAll}
								/>
							</div>

							{allowAllModels && (
								<div className="flex gap-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3.5">
									<AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" />
									<p className="text-xs leading-relaxed text-muted-foreground">
										<span className="font-medium text-yellow-600 dark:text-yellow-400">
											Prompt caching may not be available.
										</span>{" "}
										Coding models are selected because they support prompt
										caching, which reduces costs and latency. Non-curated models
										may cost more.
									</p>
								</div>
							)}

							{!allowAllModels && (
								<p className="text-xs text-muted-foreground rounded-lg bg-muted p-3.5">
									Using coding-optimized models with prompt caching, tool
									calling, JSON output, and streaming.
								</p>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
