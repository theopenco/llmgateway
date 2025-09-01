"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/lib/components/button";
import { Checkbox } from "@/lib/components/checkbox";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/lib/components/form";
import { Input } from "@/lib/components/input";
import { Separator } from "@/lib/components/separator";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { CachingSettingsData } from "@/types/settings";

const cachingFormSchema = z.object({
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z
		.number()
		.int()
		.min(10, "Cache duration must be at least 10 seconds")
		.max(
			31536000,
			"Cache duration must not exceed 31,536,000 seconds (1 year)",
		),
});

type CachingFormData = z.infer<typeof cachingFormSchema>;

interface CachingSettingsProps {
	initialData: CachingSettingsData;
	orgId: string;
	projectId: string;
	projectName: string;
}

export function CachingSettings({
	initialData,
	orgId,
	projectId,
	projectName,
}: CachingSettingsProps) {
	const { toast } = useToast();
	const queryClient = useQueryClient();

	const form = useForm<CachingFormData>({
		resolver: zodResolver(cachingFormSchema),
		defaultValues: {
			cachingEnabled:
				initialData.preferences.preferences.cachingEnabled || false,
			cacheDurationSeconds:
				initialData.preferences.preferences.cacheDurationSeconds || 60,
		},
	});

	const cachingEnabled = form.watch("cachingEnabled");

	const api = useApi();
	const updateProject = api.useMutation("patch", "/projects/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: orgId } },
			}).queryKey;
			queryClient.invalidateQueries({ queryKey });
		},
	});

	const onSubmit = async (data: CachingFormData) => {
		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: {
					cachingEnabled: data.cachingEnabled,
					cacheDurationSeconds: data.cacheDurationSeconds,
				},
			});

			toast({
				title: "Settings saved",
				description: "Your caching settings have been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save caching settings.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<h3 className="text-lg font-medium">Request Caching</h3>
				<p className="text-muted-foreground text-sm">
					Configure caching for identical LLM requests
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
						name="cachingEnabled"
						render={({ field }) => (
							<FormItem className="flex flex-row items-start space-x-3 space-y-0">
								<FormControl>
									<Checkbox
										checked={field.value}
										onCheckedChange={field.onChange}
									/>
								</FormControl>
								<div className="space-y-1 leading-none">
									<FormLabel>Enable request caching</FormLabel>
								</div>
							</FormItem>
						)}
					/>

					<FormField
						control={form.control}
						name="cacheDurationSeconds"
						render={({ field }) => (
							<FormItem>
								<FormLabel>Cache Duration (seconds)</FormLabel>
								<FormControl>
									<Input
										type="number"
										min={10}
										max={31536000}
										className="w-32"
										disabled={!cachingEnabled}
										{...field}
										onChange={(e) => field.onChange(Number(e.target.value))}
									/>
								</FormControl>
								<FormDescription>
									Min: 10, Max: 31,536,000 (one year)
									<br />
									Note: changing this setting may take up to 5 minutes to take
									effect.
								</FormDescription>
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
