"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

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
	projectName: string;
}

export function ProjectModeSettings({
	initialData,
	orgId,
	projectId,
	projectName,
}: ProjectModeSettingsProps) {
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
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: orgId } },
			}).queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const onSubmit = async (data: ProjectModeFormData) => {
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
											},
											{
												id: "credits",
												label: "Credits",
												desc: "Use your organization credits and our internal API keys",
											},
											{
												id: "hybrid",
												label: "Hybrid",
												desc: "Use your own API keys when available, fall back to credits when needed",
											},
										].map(({ id, label, desc }) => (
											<div key={id} className="flex items-start space-x-2">
												<RadioGroupItem value={id} id={id} />
												<div className="space-y-1 flex-1">
													<Label htmlFor={id} className="font-medium">
														{label}
													</Label>
													<p className="text-sm text-muted-foreground">
														{desc}
													</p>
												</div>
											</div>
										))}
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
