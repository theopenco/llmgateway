"use client";

import { AlertTriangle, Settings } from "lucide-react";
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
		<div className="rounded-lg border p-6">
			<div className="flex items-center gap-2 mb-4">
				<Settings className="h-5 w-5" />
				<h3 className="font-semibold">Model Settings</h3>
			</div>

			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<Label htmlFor="allow-all-models" className="font-medium">
							Allow all models
						</Label>
						<p className="text-sm text-muted-foreground">
							Enable access to models beyond the curated coding model list
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
					<div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-4">
						<div className="flex gap-3">
							<AlertTriangle className="h-5 w-5 text-yellow-600 shrink-0 mt-0.5" />
							<div className="space-y-1">
								<p className="text-sm font-medium text-yellow-600">
									Prompt caching may not be available
								</p>
								<p className="text-sm text-muted-foreground">
									Coding models are specifically selected because they support
									prompt caching, which significantly reduces costs and latency
									for coding tasks. Models outside this list may not support
									prompt caching, leading to higher costs and slower responses.
								</p>
							</div>
						</div>
					</div>
				)}

				{!allowAllModels && (
					<div className="rounded-md bg-muted p-4">
						<p className="text-sm text-muted-foreground">
							Your dev plan is configured to use coding-optimized models only.
							These models support prompt caching, tool calling, JSON output,
							and streaming - all essential features for AI-powered coding.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
