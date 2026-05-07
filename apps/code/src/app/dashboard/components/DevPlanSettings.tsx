"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";

interface DevPlanSettingsProps {
	devPlanAllowAllModels: boolean;
	cachingEnabled: boolean;
	cacheDurationSeconds: number;
	retentionLevel: "retain" | "none";
}

export default function DevPlanSettings({
	devPlanAllowAllModels: initialAllowAllModels,
	cachingEnabled: initialCachingEnabled,
	cacheDurationSeconds: initialCacheDurationSeconds,
	retentionLevel: initialRetentionLevel,
}: DevPlanSettingsProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [allowAllModels, setAllowAllModels] = useState(initialAllowAllModels);
	const [isUpdatingAllowAll, setIsUpdatingAllowAll] = useState(false);

	const [cachingEnabled, setCachingEnabled] = useState(initialCachingEnabled);
	const [cacheDuration, setCacheDuration] = useState(
		initialCacheDurationSeconds,
	);
	const [savedCacheDuration, setSavedCacheDuration] = useState(
		initialCacheDurationSeconds,
	);
	const [isSavingCaching, setIsSavingCaching] = useState(false);
	const [isTogglingCaching, setIsTogglingCaching] = useState(false);

	const [retainData, setRetainData] = useState(
		initialRetentionLevel === "retain",
	);
	const [isUpdatingRetention, setIsUpdatingRetention] = useState(false);

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

	const handleCachingToggle = async (checked: boolean) => {
		setIsTogglingCaching(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { cachingEnabled: checked },
			});
			setCachingEnabled(checked);
			await invalidateStatus();
			toast.success(checked ? "Caching enabled" : "Caching disabled");
		} catch {
			toast.error("Failed to update caching");
		} finally {
			setIsTogglingCaching(false);
		}
	};

	const handleSaveCacheDuration = async () => {
		if (
			!Number.isFinite(cacheDuration) ||
			cacheDuration < 10 ||
			cacheDuration > 31536000
		) {
			toast.error("Cache duration must be between 10 and 31,536,000 seconds");
			return;
		}
		setIsSavingCaching(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { cacheDurationSeconds: cacheDuration },
			});
			setSavedCacheDuration(cacheDuration);
			await invalidateStatus();
			toast.success("Cache duration updated");
		} catch {
			toast.error("Failed to update cache duration");
		} finally {
			setIsSavingCaching(false);
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
							<Label htmlFor="allow-all-models" className="text-sm font-medium">
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
								Coding models are selected because they support prompt caching,
								which reduces costs and latency. Non-curated models may cost
								more.
							</p>
						</div>
					)}

					{!allowAllModels && (
						<p className="text-xs text-muted-foreground rounded-lg bg-muted p-3.5">
							Using coding-optimized models with prompt caching, tool calling,
							JSON output, and streaming.
						</p>
					)}
				</div>

				<div className="rounded-xl border p-5 space-y-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<Label htmlFor="enable-caching" className="text-sm font-medium">
								Request caching
							</Label>
							<p className="text-xs text-muted-foreground">
								Cache identical LLM requests to reduce cost and latency
							</p>
						</div>
						<Switch
							id="enable-caching"
							checked={cachingEnabled}
							onCheckedChange={handleCachingToggle}
							disabled={isTogglingCaching}
						/>
					</div>

					<div className="space-y-2">
						<Label
							htmlFor="cache-duration"
							className={`text-sm font-medium ${
								!cachingEnabled ? "text-muted-foreground" : ""
							}`}
						>
							Cache duration (seconds)
						</Label>
						<div className="flex items-center gap-2">
							<Input
								id="cache-duration"
								type="number"
								min={10}
								max={31536000}
								className="w-40 h-9"
								value={cacheDuration}
								onChange={(e) => setCacheDuration(Number(e.target.value))}
								disabled={!cachingEnabled}
							/>
							<Button
								type="button"
								size="sm"
								variant="outline"
								onClick={handleSaveCacheDuration}
								disabled={
									!cachingEnabled ||
									isSavingCaching ||
									cacheDuration === savedCacheDuration
								}
							>
								{isSavingCaching && (
									<Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
								)}
								Save
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							Min 10, max 31,536,000 (1 year). Changes may take up to 5 minutes
							to take effect.
						</p>
					</div>
				</div>

				<div className="rounded-xl border p-5 space-y-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<Label htmlFor="retain-data" className="text-sm font-medium">
								Retain request data
							</Label>
							<p className="text-xs text-muted-foreground">
								Store full request and response payloads for analytics and
								debugging. When off, only metadata is kept.
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
			</div>
		</div>
	);
}
