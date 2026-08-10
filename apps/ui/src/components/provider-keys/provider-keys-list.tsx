"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyIcon, MoreHorizontal, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import { Input } from "@/lib/components/input";
import { StatusBadge } from "@/lib/components/status-badge";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { isStealthProvider, providers } from "@llmgateway/models";
import {
	getProviderIcon,
	ReorderableItem,
	ReorderableList,
} from "@llmgateway/shared/components";

import { CreateProviderKeyDialog } from "./create-provider-key-dialog";
import { ProviderKeyLimitDialog } from "./provider-key-limit-dialog";
import { ProviderKeyModelsDialog } from "./provider-key-models-dialog";
import { RenameProviderKeyDialog } from "./rename-provider-key-dialog";
import { reorderProviderKeys } from "./reorder-provider-keys";

import type { paths } from "@/lib/api/v1";
import type { Organization } from "@/lib/types";

type ProviderKeysResponse =
	paths["/keys/provider"]["get"]["responses"][200]["content"]["application/json"];
type ProviderKey = ProviderKeysResponse["providerKeys"][number];

interface ProviderKeysListProps {
	selectedOrganization: Organization | null;
	initialData?: ProviderKeysResponse;
}

function formatUsd(value: string): string {
	const amount = Number(value);
	return Number.isFinite(amount) ? `$${amount.toFixed(2)}` : `$${value}`;
}

/**
 * A key the billing worker auto-disabled because its attributed spend reached
 * the configured cap. Derived, not stored: re-enabling without raising the
 * limit is rejected by the API, so this state is unambiguous.
 */
function hasReachedSpendLimit(providerKey: ProviderKey): boolean {
	return (
		providerKey.status === "inactive" &&
		providerKey.usageLimit !== null &&
		Number(providerKey.usage) >= Number(providerKey.usageLimit)
	);
}

function formatOptionLabel(key: string, value: string): string {
	const labels: Record<string, string> = {
		aws_bedrock_region_prefix: "Cross-Region Prefix",
		aws_bedrock_region: "Region",
		azure_resource: "Resource",
		azure_api_version: "API Version",
		azure_deployment_type: "Deployment",
		azure_validation_model: "Validation Model",
		alibaba_region: "Region",
		alibaba_workspace_id: "Workspace ID",
	};

	const label = labels[key] || key;
	return `${label}: ${value}`;
}

export function ProviderKeysList({
	selectedOrganization,
	initialData,
}: ProviderKeysListProps) {
	const queryClient = useQueryClient();
	const api = useApi();
	const { buildOrgUrl } = useDashboardNavigation();
	const [search, setSearch] = useState("");

	// Must be built with the same init argument useQuery passes below: the key
	// includes it, and setQueryData needs an exact match (invalidateQueries
	// matches by prefix, which is why the mismatch went unnoticed).
	const queryKey = api.queryOptions("get", "/keys/provider", {}).queryKey;

	const { data } = api.useQuery(
		"get",
		"/keys/provider",
		{},
		{
			initialData,
			staleTime: 5 * 60 * 1000, // 5 minutes
			refetchOnWindowFocus: false,
		},
	);
	const deleteMutation = api.useMutation("delete", "/keys/provider/{id}");
	const toggleMutation = api.useMutation("patch", "/keys/provider/{id}");
	const reorderMutation = api.useMutation("put", "/keys/provider/order");

	// Captured at the first onReorder of a gesture. By the time the mutation
	// runs the cache already holds the new order, so the usual onMutate
	// snapshot would roll back to the wrong thing.
	const preDragOrder = useRef<{ providerKeys: ProviderKey[] } | undefined>(
		undefined,
	);
	const [savingProvider, setSavingProvider] = useState<string | null>(null);

	// Filter out LLM Gateway and stealth providers (no default base URL) from the
	// providers list: users can't configure a stealth provider key because the
	// platform behind it is undisclosed, so they must not appear as connectable.
	const availableProviders = useMemo(
		() =>
			providers.filter(
				(provider) =>
					provider.id !== "llmgateway" && !isStealthProvider(provider),
			),
		[],
	);

	const organizationKeys = useMemo(
		() =>
			selectedOrganization
				? (data?.providerKeys
						.filter((key) => key.status !== "deleted")
						.filter((key) => key.organizationId === selectedOrganization.id) ??
					[])
				: [],
		[data, selectedOrganization],
	);

	const keysByProvider = useMemo(
		() =>
			new Map(
				availableProviders.map((provider) => [
					provider.id,
					// No client-side sort: the API returns keys in the order the
					// gateway tries them, and filter() preserves it.
					organizationKeys.filter((key) => key.provider === provider.id),
				]),
			),
		[availableProviders, organizationKeys],
	);

	const normalizedSearch = search.trim().toLowerCase();
	const filteredProviders = availableProviders.filter(
		(provider) =>
			!normalizedSearch ||
			provider.name.toLowerCase().includes(normalizedSearch) ||
			provider.id.toLowerCase().includes(normalizedSearch),
	);
	const configuredProviders = filteredProviders.filter(
		(provider) => (keysByProvider.get(provider.id)?.length ?? 0) > 0,
	);
	const providersToAdd = filteredProviders.filter(
		(provider) => (keysByProvider.get(provider.id)?.length ?? 0) === 0,
	);
	const totalKeys = organizationKeys.length;

	const applyReorder = (provider: string, orderedIds: string[]) => {
		if (!preDragOrder.current) {
			preDragOrder.current = queryClient.getQueryData(queryKey);
		}
		queryClient.setQueryData(queryKey, (old: typeof data) =>
			reorderProviderKeys(old, provider, orderedIds),
		);
	};

	const commitReorder = (provider: string, orderedIds: string[]) => {
		const snapshot = preDragOrder.current;
		preDragOrder.current = undefined;
		if (!snapshot || !selectedOrganization) {
			return;
		}

		setSavingProvider(provider);
		reorderMutation.mutate(
			{
				body: {
					organizationId: selectedOrganization.id,
					provider,
					providerKeyIds: orderedIds,
				},
			},
			{
				onError: () => {
					queryClient.setQueryData(queryKey, snapshot);
					toast({
						title: "Error",
						description: "Failed to save key order",
						variant: "destructive",
					});
				},
				onSettled: () => {
					setSavingProvider(null);
					void queryClient.invalidateQueries({ queryKey });
				},
			},
		);
	};

	const deleteKey = (id: string) => {
		deleteMutation.mutate(
			{ params: { path: { id } } },
			{
				onSuccess: () => {
					toast({ title: "Deleted", description: "Provider key removed" });
					void queryClient.invalidateQueries({ queryKey });
				},
				onError: () =>
					toast({
						title: "Error",
						description: "Failed to delete key",
						variant: "destructive",
					}),
			},
		);
	};

	const toggleStatus = (
		id: string,
		currentStatus: "active" | "inactive" | "deleted" | null,
	) => {
		const newStatus = currentStatus === "active" ? "inactive" : "active";

		toggleMutation.mutate(
			{
				params: { path: { id } },
				body: { status: newStatus },
			},
			{
				onSuccess: () => {
					toast({
						title: "Status Updated",
						description: `Provider key marked as ${newStatus}`,
					});
					void queryClient.invalidateQueries({ queryKey });
				},
				onError: (error: unknown) =>
					toast({
						title: "Error",
						// Surface the server's message: re-enabling a key that sits at
						// its spend limit is rejected with an actionable explanation.
						description:
							(error as { message?: string } | undefined)?.message ??
							"Failed to update status",
						variant: "destructive",
					}),
			},
		);
	};

	if (!selectedOrganization) {
		return (
			<div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
				<div className="mb-4">
					<KeyIcon className="h-10 w-10 text-gray-500" />
				</div>
				<p className="text-gray-400 mb-6">
					Please select an organization to view provider keys.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="relative">
				<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					type="search"
					placeholder="Search providers by name..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="pl-9"
				/>
			</div>

			{configuredProviders.length === 0 && providersToAdd.length === 0 ? (
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center text-muted-foreground">
					<Search className="mb-3 h-8 w-8 opacity-60" />
					<p className="text-sm">
						No providers match{" "}
						<span className="font-medium text-foreground">“{search}”</span>.
					</p>
				</div>
			) : (
				<>
					{configuredProviders.length > 0 && (
						<section className="space-y-3">
							<div className="flex items-center gap-2">
								<h3 className="text-sm font-semibold tracking-tight">
									Your providers
								</h3>
								<Badge variant="secondary" className="text-xs">
									{totalKeys} key{totalKeys === 1 ? "" : "s"}
								</Badge>
							</div>

							<div className="space-y-3">
								{configuredProviders.map((provider) => {
									const LogoComponent = getProviderIcon(provider.id);
									const providerKeys = keysByProvider.get(provider.id) ?? [];

									return (
										<div
											key={provider.id}
											className="rounded-lg border border-border"
										>
											<div className="flex items-center justify-between gap-3 p-3">
												<div className="flex min-w-0 items-center gap-2.5">
													<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background">
														{LogoComponent ? (
															<LogoComponent className="h-5 w-5" />
														) : (
															<div className="h-5 w-5 rounded bg-muted" />
														)}
													</div>
													<div className="flex items-center gap-2">
														<span className="font-medium">{provider.name}</span>
														<Badge variant="outline" className="text-xs">
															{providerKeys.length} key
															{providerKeys.length === 1 ? "" : "s"}
														</Badge>
													</div>
												</div>

												<CreateProviderKeyDialog
													selectedOrganization={selectedOrganization}
													preselectedProvider={provider.id}
												>
													<Button
														variant="ghost"
														size="sm"
														className="shrink-0"
													>
														<Plus className="mr-1.5 h-4 w-4" />
														Add key
													</Button>
												</CreateProviderKeyDialog>
											</div>

											{providerKeys.length > 1 && (
												<p className="px-3 pb-2 text-xs text-muted-foreground">
													Tried top to bottom — the first healthy key serves the
													request. Drag to reorder.
												</p>
											)}

											<ReorderableList
												as="div"
												className="divide-y divide-border border-t border-border"
												ids={providerKeys.map((key) => key.id)}
												disabled={savingProvider === provider.id}
												onReorder={(ids) => applyReorder(provider.id, ids)}
												onCommit={(ids) => commitReorder(provider.id, ids)}
											>
												{providerKeys.map((providerKey, keyIndex) => (
													<ReorderableItem
														key={providerKey.id}
														id={providerKey.id}
														as="div"
														itemLabel={`${provider.name} key ${providerKey.maskedToken}`}
														// Opaque, or the dragged row shows the rows
														// beneath it through itself.
														className="flex items-center justify-between gap-3 bg-background px-3 py-2.5"
													>
														{(handle) => (
															<>
																{handle}
																<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
																	{hasReachedSpendLimit(providerKey) ? (
																		<Badge
																			variant="destructive"
																			className="text-[11px]"
																			title="Automatically disabled: spend reached the configured limit. Raise or clear the limit to re-enable."
																		>
																			Limit reached
																		</Badge>
																	) : (
																		<StatusBadge
																			status={providerKey.status}
																			variant="simple"
																		/>
																	)}
																	{keyIndex === 0 &&
																		providerKeys.length > 1 && (
																			<Badge
																				variant="outline"
																				className="text-[11px]"
																			>
																				Primary
																			</Badge>
																		)}
																	{provider.id === "custom" &&
																		providerKey.name && (
																			<Badge
																				variant="secondary"
																				className="text-xs"
																			>
																				{providerKey.name}
																			</Badge>
																		)}
																	{provider.id === "custom" &&
																		(providerKey.complianceAttestation ? (
																			<Badge
																				variant="secondary"
																				className="text-xs"
																			>
																				Attested
																			</Badge>
																		) : (
																			<Badge
																				variant="outline"
																				className="text-xs"
																			>
																				Not attested
																			</Badge>
																		))}
																	<span className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
																		{providerKey.maskedToken}
																	</span>
																	{providerKey.allowedModels &&
																		providerKey.allowedModels.length > 0 && (
																			<Badge
																				variant="outline"
																				className="text-xs"
																				title={`Only used for: ${providerKey.allowedModels.join(", ")}`}
																			>
																				{providerKey.allowedModels.length} model
																				{providerKey.allowedModels.length === 1
																					? ""
																					: "s"}
																			</Badge>
																		)}
																	{providerKey.usageLimit !== null && (
																		<Badge
																			variant="outline"
																			className="text-xs tabular-nums"
																			title="Spend attributed to this key against its max-spend limit. The key is automatically disabled at the limit."
																		>
																			{formatUsd(providerKey.usage)} /{" "}
																			{formatUsd(providerKey.usageLimit)}
																		</Badge>
																	)}
																	{providerKey.baseUrl && (
																		<Badge
																			variant="outline"
																			className="max-w-[220px] truncate text-xs"
																		>
																			{providerKey.baseUrl}
																		</Badge>
																	)}
																	{providerKey.options &&
																		Object.entries(providerKey.options).map(
																			([key, value]) =>
																				value && (
																					<Badge
																						key={key}
																						variant="outline"
																						className="text-xs"
																					>
																						{formatOptionLabel(
																							key,
																							String(value),
																						)}
																					</Badge>
																				),
																		)}
																</div>

																<DropdownMenu>
																	<DropdownMenuTrigger asChild>
																		<Button
																			variant="ghost"
																			size="sm"
																			className="shrink-0"
																		>
																			<MoreHorizontal className="h-4 w-4" />
																			<span className="sr-only">Open menu</span>
																		</Button>
																	</DropdownMenuTrigger>
																	<DropdownMenuContent align="end">
																		<DropdownMenuLabel>
																			Actions
																		</DropdownMenuLabel>
																		{provider.id === "custom" && (
																			<>
																				<RenameProviderKeyDialog
																					providerKeyId={providerKey.id}
																					currentName={providerKey.name}
																				>
																					<DropdownMenuItem
																						onSelect={(e) => e.preventDefault()}
																					>
																						Rename
																					</DropdownMenuItem>
																				</RenameProviderKeyDialog>
																				<DropdownMenuItem asChild>
																					<Link
																						href={
																							`${buildOrgUrl("org/models")}?providerKey=${providerKey.id}` as never
																						}
																					>
																						Manage models
																					</Link>
																				</DropdownMenuItem>
																			</>
																		)}
																		{provider.id !== "custom" && (
																			<ProviderKeyModelsDialog
																				providerKeyId={providerKey.id}
																				provider={provider.id}
																				currentAllowedModels={
																					providerKey.allowedModels
																				}
																			>
																				<DropdownMenuItem
																					onSelect={(e) => e.preventDefault()}
																				>
																					{providerKey.allowedModels &&
																					providerKey.allowedModels.length > 0
																						? "Edit allowed models"
																						: "Restrict models"}
																				</DropdownMenuItem>
																			</ProviderKeyModelsDialog>
																		)}
																		<ProviderKeyLimitDialog
																			providerKeyId={providerKey.id}
																			currentLimit={providerKey.usageLimit}
																			currentUsage={providerKey.usage}
																		>
																			<DropdownMenuItem
																				onSelect={(e) => e.preventDefault()}
																			>
																				{providerKey.usageLimit !== null
																					? "Edit spend limit"
																					: "Set spend limit"}
																			</DropdownMenuItem>
																		</ProviderKeyLimitDialog>
																		<DropdownMenuItem
																			onClick={() =>
																				toggleStatus(
																					providerKey.id,
																					providerKey.status,
																				)
																			}
																		>
																			{providerKey.status === "active"
																				? "Deactivate"
																				: "Activate"}
																		</DropdownMenuItem>
																		<DropdownMenuSeparator />
																		<AlertDialog>
																			<AlertDialogTrigger asChild>
																				<DropdownMenuItem
																					onSelect={(e) => e.preventDefault()}
																					className="text-destructive focus:text-destructive"
																				>
																					Delete
																				</DropdownMenuItem>
																			</AlertDialogTrigger>
																			<AlertDialogContent>
																				<AlertDialogHeader>
																					<AlertDialogTitle>
																						Are you absolutely sure?
																					</AlertDialogTitle>
																					<AlertDialogDescription>
																						This action cannot be undone. This
																						will permanently delete the provider
																						key and any applications using it
																						will no longer be able to access the
																						API.
																					</AlertDialogDescription>
																				</AlertDialogHeader>
																				<AlertDialogFooter>
																					<AlertDialogCancel>
																						Cancel
																					</AlertDialogCancel>
																					<AlertDialogAction
																						onClick={() =>
																							deleteKey(providerKey.id)
																						}
																						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
																					>
																						Delete
																					</AlertDialogAction>
																				</AlertDialogFooter>
																			</AlertDialogContent>
																		</AlertDialog>
																	</DropdownMenuContent>
																</DropdownMenu>
															</>
														)}
													</ReorderableItem>
												))}
											</ReorderableList>
										</div>
									);
								})}
							</div>
						</section>
					)}

					{providersToAdd.length > 0 && (
						<section className="space-y-3">
							<h3 className="text-sm font-semibold tracking-tight">
								{configuredProviders.length > 0
									? "Add another provider"
									: "Connect a provider"}
							</h3>

							<div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{providersToAdd.map((provider) => {
									const LogoComponent = getProviderIcon(provider.id);

									return (
										<CreateProviderKeyDialog
											key={provider.id}
											selectedOrganization={selectedOrganization}
											preselectedProvider={provider.id}
										>
											<button
												type="button"
												className="group flex items-center gap-2.5 rounded-lg border border-border p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
											>
												<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background">
													{LogoComponent ? (
														<LogoComponent className="h-5 w-5" />
													) : (
														<div className="h-4 w-4 rounded bg-muted" />
													)}
												</div>
												<span className="min-w-0 flex-1 truncate text-sm font-medium">
													{provider.name}
												</span>
												<Plus className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
											</button>
										</CreateProviderKeyDialog>
									);
								})}
							</div>
						</section>
					)}
				</>
			)}
		</div>
	);
}
