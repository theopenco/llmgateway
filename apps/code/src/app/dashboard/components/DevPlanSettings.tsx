"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";

interface DevPlanSettingsProps {
	devPlanAllowAllModels: boolean;
}

export default function DevPlanSettings({
	devPlanAllowAllModels: initialValue,
}: DevPlanSettingsProps) {
	const api = useApi();
	const [allowAllModels, setAllowAllModels] = useState(initialValue);
	const [isUpdating, setIsUpdating] = useState(false);

	const updateSettingsMutation = api.useMutation(
		"patch",
		"/dev-plans/settings",
	);

	const handleToggle = async (checked: boolean) => {
		setIsUpdating(true);
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
			setIsUpdating(false);
		}
	};

	return (
		<div>
			<h2 className="mb-4 font-semibold">Settings</h2>
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
						onCheckedChange={handleToggle}
						disabled={isUpdating}
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
							which reduces costs and latency. Non-curated models may cost more.
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
		</div>
	);
}
