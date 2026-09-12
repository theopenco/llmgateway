"use client";

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

import type { ProviderCacheControlMode } from "@llmgateway/models";

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

const PROVIDER_CACHE_OPTIONS: Array<{
	value: ProviderCacheControlMode;
	label: string;
	toast: string;
}> = [
	{
		value: "auto",
		label: "Automatic",
		toast: "DevPass adds cache markers on long prompts",
	},
	{
		value: "passthrough",
		label: "Client-managed",
		toast: "Only your client's own cache markers are used",
	},
	{ value: "off", label: "Disabled", toast: "Provider cache writes disabled" },
];

interface DevPlanSettingsProps {
	devPlanServiceTier: ServiceTier;
	blockApiTraining: boolean;
	defaultRoutingStrategy: RoutingStrategy;
	providerCacheControlMode: ProviderCacheControlMode;
}

export default function DevPlanSettings({
	devPlanServiceTier: initialServiceTier,
	blockApiTraining: initialBlockApiTraining,
	defaultRoutingStrategy: initialRoutingStrategy,
	providerCacheControlMode: initialProviderCacheControlMode,
}: DevPlanSettingsProps) {
	const api = useApi();

	const [routingStrategy, setRoutingStrategy] = useState<RoutingStrategy>(
		initialRoutingStrategy,
	);
	const [isUpdatingRouting, setIsUpdatingRouting] = useState(false);

	const [serviceTier, setServiceTier] =
		useState<ServiceTier>(initialServiceTier);
	const [isUpdatingServiceTier, setIsUpdatingServiceTier] = useState(false);
	const [blockApiTraining, setBlockApiTraining] = useState(
		initialBlockApiTraining,
	);
	const [isUpdatingBlockApiTraining, setIsUpdatingBlockApiTraining] =
		useState(false);
	const [providerCacheControlMode, setProviderCacheControlMode] =
		useState<ProviderCacheControlMode>(initialProviderCacheControlMode);
	const [isUpdatingProviderCache, setIsUpdatingProviderCache] = useState(false);

	const updateSettingsMutation = api.useMutation(
		"patch",
		"/dev-plans/settings",
	);

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

	const handleBlockApiTrainingChange = async (enabled: boolean) => {
		const previous = blockApiTraining;
		setBlockApiTraining(enabled);
		setIsUpdatingBlockApiTraining(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { blockApiTraining: enabled },
			});
			toast.success(
				enabled ? "No-training routing enabled" : "Standard routing enabled",
			);
		} catch {
			setBlockApiTraining(previous);
			toast.error("Failed to update AI training preference");
		} finally {
			setIsUpdatingBlockApiTraining(false);
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

	const handleProviderCacheChange = async (value: string) => {
		const option = PROVIDER_CACHE_OPTIONS.find((o) => o.value === value);
		if (!option) {
			return;
		}
		const previous = providerCacheControlMode;
		setProviderCacheControlMode(option.value);
		setIsUpdatingProviderCache(true);
		try {
			await updateSettingsMutation.mutateAsync({
				body: { providerCacheControlMode: option.value },
			});
			toast.success(option.toast);
		} catch {
			setProviderCacheControlMode(previous);
			toast.error("Failed to update provider cache writes");
		} finally {
			setIsUpdatingProviderCache(false);
		}
	};

	return (
		<div>
			<h2 className="mb-4 font-semibold">Settings</h2>
			<div className="space-y-4">
				<div className="rounded-xl border p-5">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-0.5">
							<Label
								htmlFor="block-api-training"
								className="text-sm font-medium"
							>
								No AI training
							</Label>
							<p
								id="block-api-training-description"
								className="text-xs text-muted-foreground"
							>
								Only route through providers that explicitly state API inputs
								aren&apos;t used to train models. Providers with unknown
								policies are excluded, so some models may be unavailable.
								DevPass remains metadata-only either way.
							</p>
						</div>
						<Switch
							id="block-api-training"
							aria-describedby="block-api-training-description"
							checked={blockApiTraining}
							onCheckedChange={handleBlockApiTrainingChange}
							disabled={isUpdatingBlockApiTraining}
						/>
					</div>
				</div>

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

				<div className="rounded-xl border p-5">
					<div className="flex items-start justify-between gap-4">
						<div className="space-y-0.5">
							<Label
								htmlFor="provider-cache-writes"
								className="text-sm font-medium"
							>
								Provider cache writes
							</Label>
							<p className="text-xs text-muted-foreground">
								Automatic adds cache markers to reusable prompt prefixes and
								forwards the ones your client sends. Client-managed only
								forwards your client&apos;s markers, so tools that manage their
								own caching (Claude Code, Cursor, Cline) keep working while
								requests without markers never pay for a write. Disabled strips
								every marker. Cache writes cost 1.25× for 5 minutes or 2× for 1
								hour, while cache reads cost 0.1×.
							</p>
						</div>
						<Select
							value={providerCacheControlMode}
							onValueChange={handleProviderCacheChange}
							disabled={isUpdatingProviderCache}
						>
							<SelectTrigger
								id="provider-cache-writes"
								size="sm"
								className="w-[180px]"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{PROVIDER_CACHE_OPTIONS.map((option) => (
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
			</div>
		</div>
	);
}
