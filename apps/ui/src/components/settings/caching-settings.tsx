"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { Button } from "@/lib/components/button";
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
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { Separator } from "@/lib/components/separator";
import { Switch } from "@/lib/components/switch";
import { useToast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import type { CachingSettingsData } from "@/types/settings";

const cachingFormSchema = z.object({
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z
		.number()
		.min(10, "Cache duration must be at least 10 seconds")
		.max(
			31536000,
			"Cache duration must not exceed 31,536,000 seconds (1 year)",
		),
	providerCacheControlMode: z.enum(["auto", "passthrough", "off"]),
	semanticCacheMode: z.enum(["off", "shadow", "on"]),
});

type CachingFormData = z.infer<typeof cachingFormSchema>;

const SEMANTIC_CACHE_MODE_OPTIONS = [
	{
		value: "off" as const,
		label: "Off",
		description: "Only byte-identical requests are served from the cache.",
	},
	{
		value: "shadow" as const,
		label: "Shadow",
		description:
			"Look up matches and record them on the request log, but still call the provider. Use it to see what would be served before it affects answers.",
	},
	{
		value: "on" as const,
		label: "On",
		description: "Serve the cached response for a matching prompt.",
	},
];

const PROVIDER_CACHE_CONTROL_OPTIONS = [
	{
		value: "auto",
		label: "Automatic",
		description:
			"Forward the cache markers your client sends and add markers on long prompts that have none. Best when your requests do not manage caching themselves.",
	},
	{
		value: "passthrough",
		label: "Client-managed",
		description:
			"Forward your client's markers untouched and never add any. A request writes to the provider cache only when it asked to — pick this when one key serves both a coding agent that sets its own markers and traffic that should not pay the write premium.",
	},
	{
		value: "off",
		label: "Disabled",
		description:
			"Strip every marker, including ones your client sends. No cache writes and no cache reads for this project.",
	},
] as const;

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
	const { buildOrgUrl, selectedOrganization } = useDashboardNavigation();
	const zeroDataRetentionEnabled =
		selectedOrganization?.providerCompliancePolicy?.enabled === true &&
		selectedOrganization.providerCompliancePolicy.zeroDataRetention === true;

	const form = useForm<CachingFormData>({
		resolver: zodResolver(cachingFormSchema),
		defaultValues: {
			cachingEnabled:
				initialData.preferences.preferences.cachingEnabled ?? false,
			cacheDurationSeconds:
				initialData.preferences.preferences.cacheDurationSeconds ?? 60,
			providerCacheControlMode:
				initialData.preferences.preferences.providerCacheControlMode ?? "auto",
			semanticCacheMode:
				initialData.preferences.preferences.semanticCacheMode ?? "off",
		},
	});

	const cachingEnabled = form.watch("cachingEnabled");
	const isEnterprise = selectedOrganization?.enterpriseAccess === true;

	const api = useApi();

	const updateProject = api.useMutation("patch", "/projects/{id}", {
		onSuccess: () => {
			const queryKey = api.queryOptions("get", "/orgs/{id}/projects", {
				params: { path: { id: orgId } },
			}).queryKey;
			void queryClient.invalidateQueries({ queryKey });
		},
	});

	const onSubmit = async (data: CachingFormData) => {
		try {
			await updateProject.mutateAsync({
				params: { path: { id: projectId } },
				body: {
					cachingEnabled: data.cachingEnabled,
					cacheDurationSeconds: data.cacheDurationSeconds,
					...(isEnterprise
						? { semanticCacheMode: data.semanticCacheMode }
						: {}),
					...(zeroDataRetentionEnabled
						? {}
						: { providerCacheControlMode: data.providerCacheControlMode }),
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

			{zeroDataRetentionEnabled ? (
				<div
					role="status"
					className="rounded-lg border bg-muted/50 p-4 text-sm"
				>
					<div className="font-medium">ZDR blocks caching</div>
					<p className="mt-1 text-muted-foreground">
						Response caching and provider prompt caching cannot be enabled while
						zero data retention is active. Disable ZDR in{` `}
						<span className="whitespace-nowrap">
							<Link
								href={buildOrgUrl("org/compliance")}
								className="font-medium text-foreground underline underline-offset-4"
							>
								Compliance
							</Link>
							{` `}first.
						</span>
					</p>
				</div>
			) : null}

			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<FormField
						control={form.control}
						name="cachingEnabled"
						render={({ field }) => (
							<FormItem className="flex flex-row items-start space-x-3 space-y-0">
								<FormControl>
									<Switch
										checked={field.value}
										onCheckedChange={(checked) => {
											field.onChange(checked);
											// The API turns semantic caching off with request
											// caching; keep the form in step so a later save
											// cannot re-arm it.
											if (!checked) {
												form.setValue("semanticCacheMode", "off");
											}
										}}
										disabled={zeroDataRetentionEnabled && !field.value}
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

					<Separator />

					<div>
						<h4 className="text-base font-medium">Semantic Caching</h4>
						<p className="text-muted-foreground text-sm">
							Also serve a cached response when the final user message differs
							from a cached one only in ways that cannot change the answer, such
							as letter case, trailing punctuation, contractions or
							&quot;please&quot;. The system prompt and earlier turns must match
							exactly. Requests without tools only.
						</p>
						{isEnterprise ? null : (
							<p className="text-muted-foreground text-sm mt-1">
								Available on the{" "}
								<Link
									href="/enterprise"
									className="font-medium text-foreground underline underline-offset-4"
								>
									Enterprise plan
								</Link>
								.
							</p>
						)}
					</div>

					<FormField
						control={form.control}
						name="semanticCacheMode"
						render={({ field }) => (
							<FormItem className="space-y-3">
								<FormControl>
									<RadioGroup
										value={field.value}
										onValueChange={field.onChange}
										className="gap-3"
										disabled={!cachingEnabled || !isEnterprise}
									>
										{SEMANTIC_CACHE_MODE_OPTIONS.map((option) => (
											<div
												key={option.value}
												className="flex flex-row items-start space-x-3"
											>
												<RadioGroupItem
													value={option.value}
													id={`semantic-cache-${option.value}`}
													className="mt-1"
													disabled={!cachingEnabled || !isEnterprise}
												/>
												<div className="space-y-1 leading-none">
													<Label htmlFor={`semantic-cache-${option.value}`}>
														{option.label}
													</Label>
													<p className="text-muted-foreground text-sm">
														{option.description}
													</p>
												</div>
											</div>
										))}
									</RadioGroup>
								</FormControl>
								<FormDescription>
									Requires request caching. Matches use the cache duration
									above.
								</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>

					<Separator />

					<div>
						<h4 className="text-base font-medium">Provider Cache Writes</h4>
						<p className="text-muted-foreground text-sm">
							Applies to providers that support explicit prompt-cache markers
						</p>
					</div>

					<FormField
						control={form.control}
						name="providerCacheControlMode"
						render={({ field }) => (
							<FormItem className="space-y-3">
								<FormControl>
									<RadioGroup
										value={zeroDataRetentionEnabled ? "off" : field.value}
										onValueChange={field.onChange}
										className="gap-3"
										disabled={zeroDataRetentionEnabled}
									>
										{PROVIDER_CACHE_CONTROL_OPTIONS.map((option) => (
											<div
												key={option.value}
												className="flex flex-row items-start space-x-3"
											>
												<RadioGroupItem
													value={option.value}
													id={`provider-cache-${option.value}`}
													className="mt-1"
													disabled={zeroDataRetentionEnabled}
												/>
												<div className="space-y-1 leading-none">
													<Label htmlFor={`provider-cache-${option.value}`}>
														{option.label}
													</Label>
													<p className="text-muted-foreground text-sm">
														{option.description}
													</p>
												</div>
											</div>
										))}
									</RadioGroup>
								</FormControl>
								<FormDescription>
									Cache writes are billed at 1.25× (5m) or 2× (1h) the input
									price; reads are 0.1×. Note: changing this setting may take up
									to 5 minutes to take effect.
								</FormDescription>
								<FormMessage />
							</FormItem>
						)}
					/>

					<div className="flex justify-end">
						<Button
							type="submit"
							disabled={
								form.formState.isSubmitting ||
								updateProject.isPending ||
								(zeroDataRetentionEnabled && cachingEnabled)
							}
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
