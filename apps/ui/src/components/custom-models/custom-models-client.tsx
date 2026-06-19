"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { CustomModelDialog } from "@/components/custom-models/custom-model-dialog";
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

import type { paths } from "@/lib/api/v1";

type ListResponse =
	paths["/custom-models"]["get"]["responses"][200]["content"]["application/json"];
export type CustomModel = ListResponse["customModels"][number];

export function CustomModelsClient() {
	const { selectedOrganization, buildOrgUrl } = useDashboardNavigation();
	const api = useApi();
	const queryClient = useQueryClient();
	const searchParams = useSearchParams();

	const isEnterprise = selectedOrganization?.plan === "enterprise";

	const providerKeysQueryKey = api.queryOptions(
		"get",
		"/keys/provider",
	).queryKey;
	const { data: providerKeysData } = api.useQuery("get", "/keys/provider", {});

	const customKeys = (providerKeysData?.providerKeys ?? []).filter(
		(key) =>
			key.provider === "custom" &&
			key.status !== "deleted" &&
			key.organizationId === selectedOrganization?.id,
	);

	const [selectedKeyId, setSelectedKeyId] = useState<string | undefined>(
		searchParams.get("providerKey") ?? undefined,
	);
	const effectiveKeyId =
		selectedKeyId && customKeys.some((k) => k.id === selectedKeyId)
			? selectedKeyId
			: customKeys[0]?.id;
	const selectedKey = customKeys.find((k) => k.id === effectiveKeyId);

	const listQueryKey = api.queryOptions("get", "/custom-models", {
		params: { query: { providerKeyId: effectiveKeyId ?? "" } },
	}).queryKey;
	const { data: customModelsData } = api.useQuery(
		"get",
		"/custom-models",
		{ params: { query: { providerKeyId: effectiveKeyId ?? "" } } },
		{ enabled: Boolean(effectiveKeyId) },
	);
	const customModels = customModelsData?.customModels ?? [];

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
					void queryClient.invalidateQueries({ queryKey: listQueryKey });
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
							Custom Models
							{!isEnterprise && <Badge variant="outline">Enterprise</Badge>}
						</h2>
						<p className="text-muted-foreground">
							Define pricing and limits for models served through your custom
							providers so cost and context limits are attributed and enforced.{" "}
							<Link
								href={buildOrgUrl("org/provider-keys")}
								className="underline underline-offset-4"
							>
								Manage provider keys
							</Link>
							.
						</p>
					</div>
					{selectedKey && (
						<CustomModelDialog providerKeyId={selectedKey.id}>
							<Button disabled={!isEnterprise}>
								<Plus className="mr-2 h-4 w-4" />
								Add custom model
							</Button>
						</CustomModelDialog>
					)}
				</div>

				{!isEnterprise && (
					<Card>
						<CardHeader>
							<CardTitle>Enterprise feature</CardTitle>
							<CardDescription>
								A custom model catalog requires an enterprise plan. Define
								per-key pricing, context and output limits, and capabilities so
								requests through your custom providers are billed and enforced
								instead of running unpriced.{" "}
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
									<Label htmlFor="provider-key-select">Custom provider</Label>
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
											disabled={!isEnterprise || toggleMutation.isPending}
											onCheckedChange={handleToggle}
										/>
										<div className="space-y-1">
											<Label htmlFor="custom-models-only">
												Only allow catalog models
											</Label>
											<p className="max-w-sm text-xs text-muted-foreground">
												When on, requests through this provider are limited to
												the models defined below so cost and context limits are
												always enforced.
											</p>
										</div>
									</div>
								)}
							</CardContent>
						</Card>

						<Card>
							<CardContent className="pt-6">
								{customModels.length === 0 ? (
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
												<TableHead className="text-right">Actions</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{customModels.map((model) => (
												<TableRow key={model.id}>
													<TableCell>
														<div className="font-medium">{model.modelName}</div>
														{model.displayName && (
															<div className="text-xs text-muted-foreground">
																{model.displayName}
															</div>
														)}
													</TableCell>
													<TableCell>{model.contextSize ?? "—"}</TableCell>
													<TableCell>{model.maxOutput ?? "—"}</TableCell>
													<TableCell>{formatPrice(model.inputPrice)}</TableCell>
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
																	disabled={!isEnterprise}
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
																		disabled={!isEnterprise}
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
																			will no longer be priced or limited from
																			this catalog.
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
		</div>
	);
}
