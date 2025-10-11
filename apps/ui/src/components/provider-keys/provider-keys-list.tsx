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
import { ProviderIcons } from "@/lib/components/providers-icons";
import { StatusBadge } from "@/lib/components/status-badge";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { providers } from "@llmgateway/models";

import { CreateProviderKeyDialog } from "./create-provider-key-dialog";

import type { Organization } from "@/lib/types";

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
			status: "active" | "inactive" | "deleted" | null;
			organizationId: string;
			maskedToken: string;
		}[];
	};
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
			.filter((key) => key.organizationId === selectedOrganization.id) || [];

	// Create a map of existing keys by provider
	const existingKeysMap = new Map(
		organizationKeys.map((key) => [key.provider, key]),
	);

	// Filter out LLM Gateway from the providers list
	const availableProviders = providers.filter(
		(provider) => provider.id !== "llmgateway",
	);

	const deleteKey = (id: string) => {
		deleteMutation.mutate(
			{ params: { path: { id } } },
			{
				onSuccess: () => {
					toast({ title: "Deleted", description: "Provider key removed" });
					queryClient.invalidateQueries({ queryKey });
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
					queryClient.invalidateQueries({ queryKey });
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
					const LogoComponent =
						ProviderIcons[provider.id as keyof typeof ProviderIcons];
					const existingKey = existingKeysMap.get(provider.id);
					const hasKey = !!existingKey;

					return (
						<div
							key={provider.id}
							className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
						>
							<div className="flex items-center gap-3">
								<div className="flex items-center justify-center w-10 h-10 rounded-lg bg-background border">
									{LogoComponent ? (
										<LogoComponent className="h-6 w-6" />
									) : (
										<div className="w-6 h-6 bg-muted rounded" />
									)}
								</div>
								<div className="flex flex-col">
									<div className="flex items-center gap-2">
										<span className="font-medium">{provider.name}</span>
										{hasKey && existingKey.name && (
											<Badge variant="outline" className="text-xs">
												{existingKey.name}
											</Badge>
										)}
										{hasKey && existingKey.baseUrl && (
											<Badge variant="outline" className="text-xs">
												{existingKey.baseUrl}
											</Badge>
										)}
									</div>
									{hasKey && (
										<div className="flex items-center gap-2 mt-1">
											<StatusBadge
												status={existingKey.status}
												variant="simple"
											/>
											<span className="text-xs text-muted-foreground font-mono block max-w-[200px] truncate">
												{existingKey.maskedToken}
											</span>
										</div>
									)}
								</div>
							</div>

							<div className="flex items-center gap-2">
								{hasKey ? (
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
													toggleStatus(existingKey.id, existingKey.status)
												}
											>
												{existingKey.status === "active"
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
															applications using it will no longer be able to
															access the API.
														</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>Cancel</AlertDialogCancel>
														<AlertDialogAction
															onClick={() => deleteKey(existingKey.id)}
															className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
														>
															Delete
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</DropdownMenuContent>
									</DropdownMenu>
								) : (
									<CreateProviderKeyDialog
										selectedOrganization={selectedOrganization}
										preselectedProvider={provider.id}
										existingProviderKeys={data?.providerKeys || []}
									>
										<Button variant="outline" size="sm">
											Add
										</Button>
									</CreateProviderKeyDialog>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
