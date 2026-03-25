"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyIcon, MoreHorizontal } from "lucide-react";

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
			organizationId: string;
			maskedToken: string;
		}[];
	};
}

function formatOptionLabel(key: string, value: string): string {
	const labels: Record<string, string> = {
		aws_bedrock_region_prefix: "Region",
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

	// Filter provider keys by selected organization
	const organizationKeys =
		data?.providerKeys
			.filter((key) => key.status !== "deleted")
			.filter((key) => key.organizationId === selectedOrganization.id) ?? [];

	// Filter out LLM Gateway from the providers list
	const availableProviders = providers.filter(
		(provider) => provider.id !== "llmgateway",
	);
	const providerKeysByProvider = new Map(
		availableProviders.map((provider) => [
			provider.id,
			organizationKeys
				.filter((key) => key.provider === provider.id)
				.sort((a, b) => {
					const createdAtDiff =
						new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
					if (createdAtDiff !== 0) {
						return createdAtDiff;
					}

					return a.id.localeCompare(b.id);
				}),
		]),
	);

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

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				{availableProviders.map((provider) => {
					const LogoComponent = getProviderIcon(provider.id);
					const providerKeys = providerKeysByProvider.get(provider.id) ?? [];

					return (
						<div key={provider.id} className="border border-border rounded-lg">
							<div className="flex items-center justify-between gap-4 p-4">
								<div className="flex items-center gap-3">
									<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background border">
										{LogoComponent ? (
											<LogoComponent className="h-6 w-6" />
										) : (
											<div className="w-6 h-6 bg-muted rounded" />
										)}
									</div>
									<div className="flex flex-col">
										<div className="flex items-center gap-2 flex-wrap">
											<span className="font-medium">{provider.name}</span>
											{providerKeys.length > 0 && (
												<Badge variant="outline" className="text-xs">
													{providerKeys.length} key
													{providerKeys.length === 1 ? "" : "s"}
												</Badge>
											)}
										</div>
										<p className="text-sm text-muted-foreground">
											{provider.id === "custom"
												? "Add multiple named OpenAI-compatible providers."
												: "Add one or more keys to load balance requests for this provider."}
										</p>
									</div>
								</div>

								<CreateProviderKeyDialog
									selectedOrganization={selectedOrganization}
									preselectedProvider={provider.id}
								>
									<Button variant="outline" size="sm">
										Add Key
									</Button>
								</CreateProviderKeyDialog>
							</div>

							{providerKeys.length > 0 ? (
								<div className="border-t border-border">
									{providerKeys.map((providerKey) => (
										<div
											key={providerKey.id}
											className="flex items-center justify-between gap-4 p-4"
										>
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-2 flex-wrap">
													{provider.id === "custom" && providerKey.name && (
														<Badge variant="secondary" className="text-xs">
															{providerKey.name}
														</Badge>
													)}
													{providerKey.baseUrl && (
														<Badge variant="outline" className="text-xs">
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
												<div className="flex items-center gap-2 mt-2">
													<StatusBadge
														status={providerKey.status}
														variant="simple"
													/>
													<span className="text-xs text-muted-foreground font-mono block max-w-[280px] truncate">
														{providerKey.maskedToken}
													</span>
												</div>
											</div>

											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button variant="ghost" size="sm">
														<MoreHorizontal className="h-4 w-4" />
														<span className="sr-only">Open menu</span>
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuLabel>Actions</DropdownMenuLabel>
													<DropdownMenuItem
														onClick={() =>
															toggleStatus(providerKey.id, providerKey.status)
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
																	permanently delete the provider key and any
																	applications using it will no longer be able
																	to access the API.
																</AlertDialogDescription>
															</AlertDialogHeader>
															<AlertDialogFooter>
																<AlertDialogCancel>Cancel</AlertDialogCancel>
																<AlertDialogAction
																	onClick={() => deleteKey(providerKey.id)}
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
							) : (
								<div className="px-4 pb-4 text-sm text-muted-foreground">
									No keys added yet.
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
