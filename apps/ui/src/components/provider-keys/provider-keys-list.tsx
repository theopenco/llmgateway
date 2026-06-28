"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyIcon, MoreHorizontal, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

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

import { providers } from "@llmgateway/models";
import { getProviderIcon } from "@llmgateway/shared/components";

import { CreateProviderKeyDialog } from "./create-provider-key-dialog";

import type { Organization } from "@/lib/types";
import type { ProviderKeyOptions } from "@llmgateway/db";

interface ProviderKeysListProps {
	selectedOrganization: Organization | null;
	initialData?: {
		providerKeys: {
			id: string;
			createdAt: string;
			updatedAt: string;
			provider: string;
			name: string | null;
			baseUrl: string | null;
			options: ProviderKeyOptions | null;
			status: "active" | "inactive" | "deleted" | null;
			customModelsOnly: boolean;
			organizationId: string;
			maskedToken: string;
		}[];
	};
}

function formatOptionLabel(key: string, value: string): string {
	const labels: Record<string, string> = {
		aws_bedrock_region_prefix: "Cross-Region Prefix",
		aws_bedrock_region: "Region",
		azure_resource: "Resource",
		azure_api_version: "API Version",
		azure_deployment_type: "Deployment",
		azure_validation_model: "Validation Model",
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

	const queryKey = api.queryOptions("get", "/keys/provider").queryKey;

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

	// Filter out LLM Gateway from the providers list
	const availableProviders = useMemo(
		() => providers.filter((provider) => provider.id !== "llmgateway"),
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
					organizationKeys
						.filter((key) => key.provider === provider.id)
						.sort((a, b) => {
							const createdAtDiff =
								new Date(a.createdAt).getTime() -
								new Date(b.createdAt).getTime();
							if (createdAtDiff !== 0) {
								return createdAtDiff;
							}

							return a.id.localeCompare(b.id);
						}),
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
				onError: () =>
					toast({
						title: "Error",
						description: "Failed to update status",
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

											<div className="divide-y divide-border border-t border-border">
												{providerKeys.map((providerKey) => (
													<div
														key={providerKey.id}
														className="flex items-center justify-between gap-3 px-3 py-2.5"
													>
														<div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
															<StatusBadge
																status={providerKey.status}
																variant="simple"
															/>
															{provider.id === "custom" && providerKey.name && (
																<Badge variant="secondary" className="text-xs">
																	{providerKey.name}
																</Badge>
															)}
															<span className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
																{providerKey.maskedToken}
															</span>
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
																				{formatOptionLabel(key, String(value))}
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
																<DropdownMenuLabel>Actions</DropdownMenuLabel>
																{provider.id === "custom" && (
																	<DropdownMenuItem asChild>
																		<Link
																			href={
																				`${buildOrgUrl("org/custom-models")}?providerKey=${providerKey.id}` as never
																			}
																		>
																			Manage models
																		</Link>
																	</DropdownMenuItem>
																)}
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
																				This action cannot be undone. This will
																				permanently delete the provider key and
																				any applications using it will no longer
																				be able to access the API.
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
													</div>
												))}
											</div>
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
