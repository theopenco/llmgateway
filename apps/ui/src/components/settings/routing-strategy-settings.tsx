"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Separator } from "@/lib/components/separator";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

const routingStrategyFormSchema = z.object({
	defaultRoutingStrategy: z.enum(["auto", "price", "throughput", "latency"]),
});

type RoutingStrategyFormData = z.infer<typeof routingStrategyFormSchema>;

const STRATEGY_OPTIONS: Array<{
	value: RoutingStrategyFormData["defaultRoutingStrategy"];
	label: string;
	description: string;
}> = [
	{
		value: "auto",
		label: "Automatic (recommended)",
		description: "Balance price, reliability, speed, and cache support.",
	},
	{
		value: "price",
		label: "Cheapest",
		description: "Strongly prefer the lowest-cost provider.",
	},
	{
		value: "throughput",
		label: "Highest throughput",
		description: "Strongly prefer the fastest-generating provider.",
	},
	{
		value: "latency",
		label: "Lowest latency",
		description:
			"Strongly prefer the lowest time-to-first-token (streaming requests).",
	},
];

interface RoutingStrategySettingsProps {
	initialStrategy: RoutingStrategyFormData["defaultRoutingStrategy"];
	orgId: string;
	projectId: string;
}

export function RoutingStrategySettings({
	initialStrategy,
	orgId,
	projectId,
}: RoutingStrategySettingsProps) {
	const { toast } = useToast();
	const queryClient = useQueryClient();

	const form = useForm<RoutingStrategyFormData>({
		resolver: zodResolver(routingStrategyFormSchema),
		defaultValues: {
			defaultRoutingStrategy: initialStrategy,
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

	const onSubmit = async (data: RoutingStrategyFormData) => {
		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: { defaultRoutingStrategy: data.defaultRoutingStrategy },
			});

			toast({
				title: "Settings saved",
				description: "Your default routing strategy has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save routing strategy.",
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div>
				<p className="text-muted-foreground text-sm">
					Choose how the gateway selects a provider when a model is served by
					more than one. Individual requests can override this with the{" "}
					<code className="text-xs">routing</code> field.{" "}
					<a
						href="https://docs.llmgateway.io/features/routing#routing-strategy"
						target="_blank"
						rel="noreferrer"
						className="underline underline-offset-4"
					>
						Learn more
					</a>
				</p>
			</div>

			<Separator />

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<FormField
						control={form.control}
						name="defaultRoutingStrategy"
						render={({ field }) => (
							<FormItem>
								<FormControl>
									<Select value={field.value} onValueChange={field.onChange}>
										<SelectTrigger className="w-full max-w-sm">
											<SelectValue placeholder="Select a strategy" />
										</SelectTrigger>
										<SelectContent>
											{STRATEGY_OPTIONS.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</FormControl>
								<p className="text-muted-foreground text-sm">
									{
										STRATEGY_OPTIONS.find(
											(option) => option.value === field.value,
										)?.description
									}
								</p>
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
