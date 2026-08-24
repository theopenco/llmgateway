"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { ComplianceAttestationCard } from "@/components/custom-models/compliance-attestation-card";
import { CustomModelDialog } from "@/components/custom-models/custom-model-dialog";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/lib/components/alert-dialog";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Switch } from "@/lib/components/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import {
	customModelRef,
	customProviderRef,
	getAttestationComplianceFailures,
	getProviderComplianceFailures,
	getProviderRefPolicyListFailures,
	isModelAllowedByPolicy,
	providers as providerDefinitions,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";
import { failureLabel } from "@llmgateway/shared";
import { AllModels } from "@llmgateway/shared/components";

import type { paths } from "@/lib/api/v1";
import type {
	ApiModel,
	ApiModelProviderMapping,
	ApiProvider,
} from "@llmgateway/shared/components";

type ListResponse =
	paths["/custom-models"]["get"]["responses"][200]["content"]["application/json"];
export type CustomModel = ListResponse["customModels"][number];

// Query-key prefix matching every "/custom-models" list query (with or without
// a providerKeyId filter), so mutations refresh both the directory and the
// management table.
const CUSTOM_MODELS_QUERY_PREFIX = ["get", "/custom-models"] as const;

export function OrgModelsClient({
	catalogModels,
	catalogProviders,
}: {
	catalogModels: ApiModel[];
	catalogProviders: ApiProvider[];
}) {
	const params = useParams();
	const organizationId = params.orgId as string;
	const { selectedOrganization, buildOrgUrl } = useDashboardNavigation();
	const api = useApi();
	const queryClient = useQueryClient();
	const searchParams = useSearchParams();

	const isEnterprise = selectedOrganization?.enterpriseAccess === true;

	// Project-scoped developers can browse the directory but not manage the
	// custom-model catalog — mutations are owner/admin-only (enforced
	// server-side as well). Management UI is hidden entirely for them.
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isOrgAdmin = currentUserRole === "owner" || currentUserRole === "admin";
	const canManage = isEnterprise && isOrgAdmin;

	const providerKeysQueryKey = api.queryOptions(
		"get",
		"/keys/provider",
	).queryKey;
	const { data: providerKeysData } = api.useQuery("get", "/keys/provider", {});

	const customKeys = useMemo(
		() =>
			(providerKeysData?.providerKeys ?? []).filter(
				(key) =>
					key.provider === "custom" &&
					key.status !== "deleted" &&
					key.organizationId === selectedOrganization?.id,
			),
		[providerKeysData, selectedOrganization?.id],
	);

	const { data: customModelsData } = api.useQuery("get", "/custom-models", {});
	const orgCustomModels = useMemo(
		() =>
			(customModelsData?.customModels ?? []).filter(
				(model) => model.organizationId === selectedOrganization?.id,
			),
		[customModelsData, selectedOrganization?.id],
	);

	// Mirrors the gateway's getActiveCompliancePolicy: enterprise orgs with an
	// explicitly enabled policy only.
	const activePolicy: ProviderCompliancePolicy | undefined =
		isEnterprise && selectedOrganization?.providerCompliancePolicy?.enabled
			? selectedOrganization.providerCompliancePolicy
			: undefined;

	const directoryModels: ApiModel[] = useMemo(() => {
		// Reasons a model is excluded by the policy's fine-grained model lists.
		// The refs mirror what the gateway checks at request time.
		const modelListReasons = (refs: string[]): string[] => {
			if (!activePolicy || isModelAllowedByPolicy(refs, activePolicy)) {
				return [];
			}
			return [
				activePolicy.blockedModels?.some((ref) => refs.includes(ref))
					? "On the blocked-models list"
					: "Not on the allowed-models list",
			];
		};

		// Per-provider compliance failures, humanized once per provider.
		const providerReasons = new Map<string, string[]>();
		if (activePolicy) {
			for (const definition of providerDefinitions) {
				providerReasons.set(
					definition.id,
					getProviderComplianceFailures(definition, activePolicy).map(
						(reason) => failureLabel(reason, definition.headquarters),
					),
				);
			}
		}

		const catalog: ApiModel[] = catalogModels.map((model) => {
			if (!activePolicy) {
				return { ...model, source: "catalog" as const };
			}
			const modelReasons = modelListReasons([model.id]);
			return {
				...model,
				source: "catalog" as const,
				mappings: model.mappings.map((mapping) => {
					const reasons = [
						// Providers missing from the catalogue definitions fail closed,
						// exactly like the gateway's isProviderIdCompliant.
						...(providerReasons.get(mapping.providerId) ?? [
							"Provider not recognized by the compliance policy",
						]),
						...modelReasons,
					];
					return reasons.length
						? { ...mapping, blockedReasons: reasons }
						: mapping;
				}),
			};
		});

		const custom: ApiModel[] = orgCustomModels.flatMap((model) => {
			const key = customKeys.find((k) => k.id === model.providerKeyId);
			if (!key?.name) {
				return [];
			}
			const providerId = customProviderRef(key.name);
			const blockedReasons = activePolicy
				? Array.from(
						new Set([
							...getProviderRefPolicyListFailures(providerId, activePolicy).map(
								(reason) => failureLabel(reason, null),
							),
							...getAttestationComplianceFailures(
								key.complianceAttestation,
								activePolicy,
							).map((reason) =>
								failureLabel(reason, key.complianceAttestation?.headquarters),
							),
							...modelListReasons([
								model.modelName,
								customModelRef(key.name, model.modelName),
							]),
						]),
					)
				: [];

			const mapping: ApiModelProviderMapping = {
				id: model.id,
				createdAt: String(model.createdAt),
				modelId: customModelRef(key.name, model.modelName),
				providerId,
				externalId: model.modelName,
				region: null,
				inputPrice: model.inputPrice,
				outputPrice: model.outputPrice,
				cachedInputPrice: model.cachedInputPrice,
				cacheWriteInputPrice: model.cacheWriteInputPrice,
				cacheWriteInputPrice1h: model.cacheWriteInputPrice1h,
				imageInputPrice: model.imageInputPrice,
				imageOutputPrice: null,
				imageInputTokensByResolution: null,
				imageOutputTokensByResolution: null,
				inputCharacterPrice: null,
				outputAudioPrice: null,
				requestPrice: model.requestPrice,
				contextSize: model.contextSize,
				maxOutput: model.maxOutput,
				streaming: model.streaming === "true" || model.streaming === "only",
				vision: model.vision,
				reasoning: model.reasoning,
				reasoningOutput: null,
				reasoningMaxTokens: null,
				rerank: null,
				tools: model.tools,
				jsonOutput: model.jsonOutput,
				jsonOutputSchema: null,
				webSearch: null,
				webSearchPrice: model.webSearchPrice,
				supportedVideoSizes: null,
				supportedVideoDurationsSeconds: null,
				supportsVideoAudio: null,
				supportsVideoWithoutAudio: null,
				perSecondPrice: null,
				perImagePrice: null,
				pricingTiers: null,
				discount: null,
				stability: null,
				supportedParameters: model.supportedParameters,
				deprecatedAt: null,
				deactivatedAt: null,
				status: model.status === "inactive" ? "inactive" : "active",
				...(blockedReasons.length ? { blockedReasons } : {}),
			};

			return [
				{
					id: customModelRef(key.name, model.modelName),
					createdAt: String(model.createdAt),
					releasedAt: null,
					name: model.displayName ?? model.modelName,
					aliases: [model.modelName],
					description: null,
					family: key.name,
					free: false,
					output: model.audio ? ["text", "audio"] : ["text"],
					stability: null,
					status: "active" as const,
					premium: false,
					source: "custom" as const,
					mappings: [mapping],
				},
			];
		});

		return [...custom, ...catalog];
	}, [catalogModels, orgCustomModels, customKeys, activePolicy]);

	const directoryProviders: ApiProvider[] = useMemo(
		() => [
			...catalogProviders,
			...customKeys
				.filter((key) => key.name)
				.map((key) => ({
					id: customProviderRef(key.name!),
					createdAt: String(key.createdAt),
					name: key.name!,
					description: null,
					streaming: null,
					cancellation: null,
					color: "#6366f1",
					website: null,
					announcement: null,
					status: "active" as const,
				})),
		],
		[catalogProviders, customKeys],
	);

	// Management section state (admins only): pick one custom provider key to
	// manage its catalog + attestation.
	const [selectedKeyId, setSelectedKeyId] = useState<string | undefined>(
		searchParams.get("providerKey") ?? undefined,
	);
	const effectiveKeyId =
		selectedKeyId && customKeys.some((k) => k.id === selectedKeyId)
			? selectedKeyId
			: customKeys[0]?.id;
	const selectedKey = customKeys.find((k) => k.id === effectiveKeyId);
	const selectedKeyModels = orgCustomModels.filter(
		(model) => model.providerKeyId === effectiveKeyId,
	);

	const toggleMutation = api.useMutation("patch", "/keys/provider/{id}");
	const deleteMutation = api.useMutation("delete", "/custom-models/{id}");

	const handleToggle = (checked: boolean) => {
		if (!selectedKey) {
			return;
		}
		toggleMutation.mutate(
			{
				params: { path: { id: selectedKey.id } },
				body: { customModelsOnly: checked },
			},
			{
				onSuccess: () => {
					toast({
						title: checked
							? "Restricted to catalog models"
							: "All custom models allowed",
					});
					void queryClient.invalidateQueries({
						queryKey: providerKeysQueryKey,
					});
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						description:
							error instanceof Error
								? error.message
								: "Failed to update setting",
						variant: "destructive",
					}),
			},
		);
	};

	const handleDelete = (id: string) => {
		deleteMutation.mutate(
			{ params: { path: { id } } },
			{
				onSuccess: () => {
					toast({ title: "Custom model deleted" });
					void queryClient.invalidateQueries({
						queryKey: CUSTOM_MODELS_QUERY_PREFIX,
					});
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						description:
							error instanceof Error
								? error.message
								: "Failed to delete custom model",
						variant: "destructive",
					}),
			},
		);
	};

	const formatPrice = (value: string | null) => (value ? value : "—");

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
							Models
							{isEnterprise && currentUserRole === "developer" && (
								<Badge variant="outline">Read-only</Badge>
							)}
						</h2>
						<p className="text-muted-foreground">
							All catalog models plus your organization&apos;s custom models.
							{activePolicy
								? " Models that are not eligible under your organization's compliance policy are marked and can be filtered out."
								: ""}{" "}
							<Link
								href={buildOrgUrl("org/provider-keys")}
								className="underline underline-offset-4"
							>
								Manage provider keys
							</Link>
							{isOrgAdmin && isEnterprise ? (
								<>
									{" · "}
									<Link
										href={buildOrgUrl("org/compliance")}
										className="underline underline-offset-4"
									>
										Compliance policy
									</Link>
								</>
							) : null}
							.
						</p>
					</div>
					{selectedKey && isOrgAdmin && (
						<CustomModelDialog providerKeyId={selectedKey.id}>
							<Button disabled={!canManage}>
								<Plus className="mr-2 h-4 w-4" />
								Add custom model
							</Button>
						</CustomModelDialog>
					)}
				</div>

				<AllModels
					models={directoryModels}
					providers={directoryProviders}
					hideHeader
				>
					{null}
				</AllModels>

				{isOrgAdmin && (
					<div className="space-y-4">
						<div>
							<h3 className="text-xl font-semibold tracking-tight">
								Custom model catalog
							</h3>
							<p className="text-muted-foreground text-sm">
								Define pricing and limits for models served through your custom
								providers so cost and context limits are attributed and
								enforced.
							</p>
						</div>

						{!isEnterprise && (
							<Card>
								<CardHeader>
									<CardTitle>
										Enterprise feature{" "}
										<Badge variant="outline">Enterprise</Badge>
									</CardTitle>
									<CardDescription>
										A custom model catalog requires an enterprise plan. Define
										per-key pricing, context and output limits, and capabilities
										so requests through your custom providers are billed and
										enforced instead of running unpriced.{" "}
										<Link
											href="https://docs.llmgateway.io/features/custom-providers#custom-model-catalog"
											target="_blank"
											rel="noopener noreferrer"
											className="underline underline-offset-4"
										>
											Learn how custom models work
										</Link>
										.
									</CardDescription>
								</CardHeader>
							</Card>
						)}

						{customKeys.length === 0 ? (
							<Card>
								<CardContent className="py-10 text-center text-muted-foreground">
									No custom provider keys yet. Create one on the{" "}
									<Link
										href={buildOrgUrl("org/provider-keys")}
										className="underline underline-offset-4"
									>
										Provider Keys
									</Link>{" "}
									page first.
								</CardContent>
							</Card>
						) : (
							<>
								<Card>
									<CardContent className="flex flex-col gap-6 pt-6 sm:flex-row sm:items-center sm:justify-between">
										<div className="space-y-2">
											<Label htmlFor="provider-key-select">
												Custom provider
											</Label>
											<Select
												value={effectiveKeyId}
												onValueChange={(v) => setSelectedKeyId(v)}
											>
												<SelectTrigger
													id="provider-key-select"
													className="w-[260px]"
												>
													<SelectValue placeholder="Select a provider" />
												</SelectTrigger>
												<SelectContent>
													{customKeys.map((key) => (
														<SelectItem key={key.id} value={key.id}>
															{key.name ?? key.id}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>

										{selectedKey && (
											<div className="flex items-start gap-3">
												<Switch
													id="custom-models-only"
													checked={Boolean(selectedKey.customModelsOnly)}
													disabled={!canManage || toggleMutation.isPending}
													onCheckedChange={handleToggle}
												/>
												<div className="space-y-1">
													<Label htmlFor="custom-models-only">
														Only allow catalog models
													</Label>
													<p className="max-w-sm text-xs text-muted-foreground">
														When on, requests through this provider are limited
														to the models defined below so cost and context
														limits are always enforced.
													</p>
												</div>
											</div>
										)}
									</CardContent>
								</Card>

								{selectedKey && selectedOrganization && (
									<ComplianceAttestationCard
										key={selectedKey.id}
										providerKey={selectedKey}
										organizationId={selectedOrganization.id}
										canManage={canManage}
									/>
								)}

								<Card>
									<CardContent className="pt-6">
										{selectedKeyModels.length === 0 ? (
											<div className="py-10 text-center text-muted-foreground">
												No custom models defined for this provider yet.
											</div>
										) : (
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead>Model</TableHead>
														<TableHead>Context</TableHead>
														<TableHead>Max output</TableHead>
														<TableHead>Input price</TableHead>
														<TableHead>Output price</TableHead>
														<TableHead className="text-right">
															Actions
														</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{selectedKeyModels.map((model) => (
														<TableRow key={model.id}>
															<TableCell>
																<div className="font-medium">
																	{model.modelName}
																</div>
																{model.displayName && (
																	<div className="text-xs text-muted-foreground">
																		{model.displayName}
																	</div>
																)}
															</TableCell>
															<TableCell>{model.contextSize ?? "—"}</TableCell>
															<TableCell>{model.maxOutput ?? "—"}</TableCell>
															<TableCell>
																{formatPrice(model.inputPrice)}
															</TableCell>
															<TableCell>
																{formatPrice(model.outputPrice)}
															</TableCell>
															<TableCell className="text-right">
																<div className="flex justify-end gap-1">
																	<CustomModelDialog
																		providerKeyId={selectedKey!.id}
																		model={model}
																	>
																		<Button
																			variant="ghost"
																			size="sm"
																			disabled={!canManage}
																		>
																			<Pencil className="h-4 w-4" />
																			<span className="sr-only">Edit</span>
																		</Button>
																	</CustomModelDialog>
																	<AlertDialog>
																		<AlertDialogTrigger asChild>
																			<Button
																				variant="ghost"
																				size="sm"
																				disabled={!canManage}
																				className="text-destructive focus:text-destructive"
																			>
																				<Trash2 className="h-4 w-4" />
																				<span className="sr-only">Delete</span>
																			</Button>
																		</AlertDialogTrigger>
																		<AlertDialogContent>
																			<AlertDialogHeader>
																				<AlertDialogTitle>
																					Delete custom model?
																				</AlertDialogTitle>
																				<AlertDialogDescription>
																					Requests for{" "}
																					<span className="font-mono">
																						{model.modelName}
																					</span>{" "}
																					will no longer be priced or limited
																					from this catalog.
																				</AlertDialogDescription>
																			</AlertDialogHeader>
																			<AlertDialogFooter>
																				<AlertDialogCancel>
																					Cancel
																				</AlertDialogCancel>
																				<AlertDialogAction
																					onClick={() => handleDelete(model.id)}
																					className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
																				>
																					Delete
																				</AlertDialogAction>
																			</AlertDialogFooter>
																		</AlertDialogContent>
																	</AlertDialog>
																</div>
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										)}
									</CardContent>
								</Card>
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
