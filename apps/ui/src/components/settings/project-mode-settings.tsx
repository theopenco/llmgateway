"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Form,
	FormControl,
	FormField,
	FormItem,
	FormMessage,
} from "@/lib/components/form";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Separator } from "@/lib/components/separator";
import { useToast } from "@/lib/components/use-toast";
import { useAppConfig } from "@/lib/config";
import { useApi } from "@/lib/fetch-client";

import type { ProjectModeSettingsData } from "@/types/settings";

const projectModeFormSchema = z.object({
	mode: z.enum(["api-keys", "credits", "hybrid"]),
});

type ProjectModeFormData = z.infer<typeof projectModeFormSchema>;

interface ProjectModeSettingsProps {
	initialData: ProjectModeSettingsData;
	orgId: string;
	projectId: string;
	organizationPlan: "free" | "pro";
	projectName: string;
}

export function ProjectModeSettings({
	initialData,
	orgId,
	projectId,
	organizationPlan,
	projectName,
}: ProjectModeSettingsProps) {
	const config = useAppConfig();
	const { toast } = useToast();
	const queryClient = useQueryClient();

	const form = useForm<ProjectModeFormData>({
		resolver: zodResolver(projectModeFormSchema),
		defaultValues: {
			mode: initialData.project.mode || "api-keys",
		},
	});

	const api = useApi();
	const updateProject = api.useMutation("patch", "/projects/{id}", {
		onSuccess: (data) => {
			const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: orgId } },
			}).queryKey;
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const isProPlan = organizationPlan === "pro";

	const onSubmit = async (data: ProjectModeFormData) => {
		// Check if trying to set api-keys mode without pro plan (only if paid mode is enabled)
		// Allow switching back to hybrid for free users, but prevent switching to api-keys
		if (data.mode === "api-keys" && config.hosted && !isProPlan) {
			toast({
				title: "Upgrade Required",
				description:
					"API Keys mode is only available on the Pro plan. Please upgrade to use API keys mode or switch to Credits mode.",
				variant: "destructive",
			});
			return;
		}

		// Always allow switching to hybrid mode for free users (no restrictions)

		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: { mode: data.mode },
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
				<p className="text-muted-foreground text-sm mt-1">
					Project: {projectName}
				</p>
			</div>

			<Separator />

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<FormField
						control={form.control}
						name="mode"
						render={({ field }) => (
							<FormItem>
								<FormControl>
									<RadioGroup
										value={field.value}
										onValueChange={field.onChange}
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
												allowSwitchBack: true, // Allow switching back to hybrid for free users
											},
										].map(
											({ id, label, desc, requiresPro, allowSwitchBack }) => {
												const isDisabled =
													requiresPro &&
													config.hosted &&
													!isProPlan &&
													!allowSwitchBack; // Always allow hybrid for free users
												return (
													<div key={id} className="flex items-start space-x-2">
														<RadioGroupItem
															value={id}
															id={id}
															disabled={isDisabled}
														/>
														<div className="space-y-1 flex-1">
															<div className="flex items-center gap-2">
																<Label
																	htmlFor={id}
																	className={`font-medium ${isDisabled ? "text-muted-foreground" : ""}`}
																>
																	{label}
																</Label>
																{isDisabled && (
																	<Badge variant="outline" className="text-xs">
																		Pro Only
																	</Badge>
																)}
															</div>
															<p
																className={`text-sm ${
																	isDisabled
																		? "text-muted-foreground"
																		: "text-muted-foreground"
																}`}
															>
																{desc}
															</p>
														</div>
													</div>
												);
											},
										)}
									</RadioGroup>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					<div className="flex justify-end">
						<Button
							type="submit"
							disabled={form.formState.isSubmitting || updateProject.isPending}
						>
							{form.formState.isSubmitting || updateProject.isPending
								? "Saving..."
								: "Save Settings"}
						</Button>
					</div>
				</form>
			</Form>
		</div>
	);
}
