"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";

type RoutingStrategy = "auto" | "price" | "throughput" | "latency";

// Coding plans optimize for prompt caching, so only "auto" and "price" are
// selectable. The throughput/latency options are shown but disabled.
const ROUTING_OPTIONS: Array<{
	value: RoutingStrategy;
	label: string;
	allowed: boolean;
}> = [
	{ value: "auto", label: "Automatic (recommended)", allowed: true },
	{ value: "price", label: "Cheapest", allowed: true },
	{ value: "throughput", label: "Highest throughput", allowed: false },
	{ value: "latency", label: "Lowest latency", allowed: false },
];

type ServiceTier = "default" | "flex";

const SERVICE_TIER_OPTIONS: Array<{ value: ServiceTier; label: string }> = [
	{ value: "default", label: "Standard (recommended)" },
	{ value: "flex", label: "Flex" },
];

interface DevPlanSettingsProps {
	devPlanServiceTier: ServiceTier;
	retentionLevel: "retain" | "none";
	defaultRoutingStrategy: RoutingStrategy;
}

export default function DevPlanSettings({
	devPlanServiceTier: initialServiceTier,
	retentionLevel: initialRetentionLevel,
	defaultRoutingStrategy: initialRoutingStrategy,
}: DevPlanSettingsProps) {
	const api = useApi();
	const queryClient = useQueryClient();

	const [retainData, setRetainData] = useState(
		initialRetentionLevel === "retain",
	);
	const [isUpdatingRetention, setIsUpdatingRetention] = useState(false);

	const [routingStrategy, setRoutingStrategy] = useState<RoutingStrategy>(
		initialRoutingStrategy,
	);
	const [isUpdatingRouting, setIsUpdatingRouting] = useState(false);

	const [serviceTier, setServiceTier] =
		useState<ServiceTier>(initialServiceTier);
	const [isUpdatingServiceTier, setIsUpdatingServiceTier] = useState(false);

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

	const handleRoutingChange = async (value: string) => {
		const strategy = value as RoutingStrategy;
		if (strategy !== "auto" && strategy !== "price") {
			return;
		}
		const previous = routingStrategy;
		setRoutingStrategy(strategy);
		setIsUpdatingRouting(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { defaultRoutingStrategy: strategy },
			});
			toast.success("Routing strategy updated");
		} catch {
			setRoutingStrategy(previous);
			toast.error("Failed to update routing strategy");
		} finally {
			setIsUpdatingRouting(false);
		}
	};

	const handleServiceTierChange = async (value: string) => {
		const tier = value as ServiceTier;
		if (tier !== "default" && tier !== "flex") {
			return;
		}
		const previous = serviceTier;
		setServiceTier(tier);
		setIsUpdatingServiceTier(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { devPlanServiceTier: tier },
			});
			toast.success(
				tier === "flex"
					? "Requests default to flex processing"
					: "Requests default to standard processing",
			);
		} catch {
			setServiceTier(previous);
			toast.error("Failed to update service tier");
		} finally {
			setIsUpdatingServiceTier(false);
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
							<Label htmlFor="routing-strategy" className="text-sm font-medium">
								Default routing strategy
							</Label>
							<p className="text-xs text-muted-foreground">
								How the gateway picks a provider when a model is served by more
								than one. Throughput and latency strategies aren&apos;t
								available on coding plans because they bypass prompt-cache–aware
								routing.{" "}
								<a
									href="https://docs.llmgateway.io/features/routing#routing-strategy"
									target="_blank"
									rel="noreferrer"
									className="underline underline-offset-2"
								>
									Learn more
								</a>
							</p>
						</div>
						<Select
							value={routingStrategy}
							onValueChange={handleRoutingChange}
							disabled={isUpdatingRouting}
						>
							<SelectTrigger
								id="routing-strategy"
								size="sm"
								className="w-[180px]"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ROUTING_OPTIONS.map((option) => (
									<SelectItem
										key={option.value}
										value={option.value}
										disabled={!option.allowed}
									>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="rounded-xl border p-5 space-y-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-0.5">
							<Label htmlFor="service-tier" className="text-sm font-medium">
								Default service tier
							</Label>
							<p className="text-xs text-muted-foreground">
								Flex processing costs less and saves your plan credits, but
								responses may be slower during peak demand. Only applied for
								models that support it — everything else stays on standard
								processing.{" "}
								<a
									href="https://docs.llmgateway.io/features/service-tiers"
									target="_blank"
									rel="noreferrer"
									className="underline underline-offset-2"
								>
									Learn more
								</a>
							</p>
						</div>
						<Select
							value={serviceTier}
							onValueChange={handleServiceTierChange}
							disabled={isUpdatingServiceTier}
						>
							<SelectTrigger id="service-tier" size="sm" className="w-[180px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SERVICE_TIER_OPTIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
			</div>
		</div>
	);
}
