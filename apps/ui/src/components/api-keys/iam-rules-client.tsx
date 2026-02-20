"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	AlertCircle,
	ArrowLeft,
	CheckCircle2,
	Lock,
	Plus,
	Shield,
	Trash2,
	Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import { models, providers } from "@llmgateway/models";
import {
	MultiModelSelector,
	MultiProviderSelector,
} from "@llmgateway/shared/components";

import type { ApiKey } from "@/lib/types";
import type { Route } from "next";

export interface IamRule {
	id: string;
	createdAt: string;
	updatedAt: string;
	ruleType:
		| "allow_models"
		| "deny_models"
		| "allow_pricing"
		| "deny_pricing"
		| "allow_providers"
		| "deny_providers";
	ruleValue: {
		models?: string[];
		providers?: string[];
		pricingType?: "free" | "paid";
		maxInputPrice?: number;
		maxOutputPrice?: number;
	};
	status: "active" | "inactive";
}

interface IamRulesClientProps {
	apiKey: ApiKey;
}

export function IamRulesClient({ apiKey }: IamRulesClientProps) {
	const pathname = usePathname();
	const { orgId, projectId } = useMemo(
		() => extractOrgAndProjectFromPath(pathname),
		[pathname],
	);

	const [newRule, setNewRule] = useState<{
		ruleType: IamRule["ruleType"];
		models: string[];
		providers: string[];
		pricingType: string;
		maxInputPrice: string;
		maxOutputPrice: string;
	}>({
		ruleType: "allow_models",
		models: [],
		providers: [],
		pricingType: "",
		maxInputPrice: "",
		maxOutputPrice: "",
	});

	const queryClient = useQueryClient();
	const api = useApi();

	// Fetch IAM rules for this API key
	const { data: rulesData, isLoading } = api.useQuery(
		"get",
		"/keys/api/{id}/iam",
		{
			params: {
				path: { id: apiKey.id },
			},
		},
	);

	// Mutations
	const { mutate: createRule, isPending: isCreating } = api.useMutation(
		"post",
		"/keys/api/{id}/iam",
	);
	const { mutate: deleteRule } = api.useMutation(
		"delete",
		"/keys/api/{id}/iam/{ruleId}",
	);

	const handleCreateRule = () => {
		const ruleValue: IamRule["ruleValue"] = {};

		// Parse rule value based on rule type
		if (newRule.ruleType.includes("models") && newRule.models.length > 0) {
			ruleValue.models = newRule.models;
		}
		if (
			newRule.ruleType.includes("providers") &&
			newRule.providers.length > 0
		) {
			ruleValue.providers = newRule.providers;
		}
		if (newRule.ruleType.includes("pricing")) {
			if (newRule.pricingType && newRule.pricingType !== "any") {
				ruleValue.pricingType = newRule.pricingType as "free" | "paid";
			}
			if (newRule.maxInputPrice) {
				ruleValue.maxInputPrice = parseFloat(newRule.maxInputPrice);
			}
			if (newRule.maxOutputPrice) {
				ruleValue.maxOutputPrice = parseFloat(newRule.maxOutputPrice);
			}
		}

		createRule(
			{
				params: { path: { id: apiKey.id } },
				body: {
					ruleType: newRule.ruleType,
					ruleValue,
					status: "active",
				},
			},
			{
				onSuccess: () => {
					void queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/keys/api/{id}/iam", {
							params: { path: { id: apiKey.id } },
						}).queryKey,
					});

					// Reset form
					setNewRule({
						ruleType: "allow_models",
						models: [],
						providers: [],
						pricingType: "",
						maxInputPrice: "",
						maxOutputPrice: "",
					});

					toast({ title: "IAM rule created successfully" });
				},
			},
		);
	};

	const handleDeleteRule = (ruleId: string) => {
		deleteRule(
			{
				params: { path: { id: apiKey.id, ruleId } },
			},
			{
				onSuccess: () => {
					void queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/keys/api/{id}/iam", {
							params: { path: { id: apiKey.id } },
						}).queryKey,
					});

					toast({ title: "IAM rule deleted successfully" });
				},
			},
		);
	};

	const formatRuleValue = (rule: IamRule) => {
		const { ruleValue, ruleType } = rule;

		if (ruleType.includes("models") && ruleValue.models) {
			return ruleValue.models.join(", ");
		}
		if (ruleType.includes("providers") && ruleValue.providers) {
			return ruleValue.providers.join(", ");
		}
		if (ruleType.includes("pricing")) {
			const parts = [];
			if (ruleValue.pricingType) {
				parts.push(`Type: ${ruleValue.pricingType}`);
			}
			if (ruleValue.maxInputPrice) {
				parts.push(`Max input: $${ruleValue.maxInputPrice}/M tokens`);
			}
			if (ruleValue.maxOutputPrice) {
				parts.push(`Max output: $${ruleValue.maxOutputPrice}/M tokens`);
			}
			return parts.join(", ") || "No constraints";
		}

		return "No constraints";
	};

	const getRuleTypeLabel = (ruleType: string) => {
		return ruleType.replace("_", " ").toUpperCase();
	};

	const getRuleTypeColor = (ruleType: string) => {
		if (ruleType.startsWith("allow")) {
			return "default";
		}
		if (ruleType.startsWith("deny")) {
			return "destructive";
		}
		return "secondary";
	};

	const backUrl = `/dashboard/${orgId}/${projectId}/api-keys`;

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<div className="mx-auto w-full max-w-7xl">
				{/* Header */}
				<div className="border-b border-border/40 bg-card/50 px-6 py-6 backdrop-blur-sm">
					<Link
						href={backUrl as Route}
						className="group mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
						Back to API Keys
					</Link>
					<div className="flex items-start gap-3">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
							<Shield className="h-6 w-6 text-primary" />
						</div>
						<div className="flex-1">
							<h1 className="text-balance text-2xl font-bold tracking-tight">
								IAM Rules
							</h1>
							<p className="mt-1 text-pretty text-sm text-muted-foreground">
								Configure access control rules for{" "}
								<span className="font-medium text-foreground">
									{apiKey.description}
								</span>
							</p>
						</div>
					</div>
				</div>

				<div className="space-y-5 p-6">
					{/* Create new rule form */}
					<Card className="border-border/50 shadow-sm">
						<CardHeader className="space-y-0.5 pb-2">
							<div className="flex items-center gap-2">
								<Plus className="h-4 w-4 text-primary" />
								<CardTitle className="text-lg">Create New Rule</CardTitle>
							</div>
							<CardDescription className="text-sm">
								Add access control rules to restrict model access by type,
								provider, or pricing.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
								<div className="space-y-1">
									<Label htmlFor="ruleType" className="text-sm font-medium">
										Rule Type
									</Label>
									<Select
										value={newRule.ruleType}
										onValueChange={(value) =>
											setNewRule((prev) => ({
												...prev,
												ruleType: value as IamRule["ruleType"],
											}))
										}
									>
										<SelectTrigger className="h-9">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="allow_models">
												<div className="flex items-center gap-2">
													<CheckCircle2 className="h-4 w-4 text-green-500" />
													Allow Specific Models
												</div>
											</SelectItem>
											<SelectItem value="deny_models">
												<div className="flex items-center gap-2">
													<AlertCircle className="h-4 w-4 text-red-500" />
													Deny Specific Models
												</div>
											</SelectItem>
											<SelectItem value="allow_providers">
												<div className="flex items-center gap-2">
													<CheckCircle2 className="h-4 w-4 text-green-500" />
													Allow Specific Providers
												</div>
											</SelectItem>
											<SelectItem value="deny_providers">
												<div className="flex items-center gap-2">
													<AlertCircle className="h-4 w-4 text-red-500" />
													Deny Specific Providers
												</div>
											</SelectItem>
											<SelectItem value="allow_pricing">
												<div className="flex items-center gap-2">
													<Zap className="h-4 w-4 text-yellow-500" />
													Allow Pricing Constraints
												</div>
											</SelectItem>
											<SelectItem value="deny_pricing">
												<div className="flex items-center gap-2">
													<Zap className="h-4 w-4 text-yellow-500" />
													Deny Pricing Constraints
												</div>
											</SelectItem>
										</SelectContent>
									</Select>
								</div>

								{(newRule.ruleType === "allow_models" ||
									newRule.ruleType === "deny_models") && (
									<div className="space-y-1">
										<Label htmlFor="models" className="text-sm font-medium">
											Models
										</Label>
										<MultiModelSelector
											models={models}
											providers={providers}
											selectedModels={newRule.models}
											onModelsChange={(selectedModels: string[]) =>
												setNewRule((prev) => ({
													...prev,
													models: selectedModels,
												}))
											}
											placeholder="Select models..."
										/>
									</div>
								)}

								{(newRule.ruleType === "allow_providers" ||
									newRule.ruleType === "deny_providers") && (
									<div className="space-y-1">
										<Label htmlFor="providers" className="text-sm font-medium">
											Providers
										</Label>
										<MultiProviderSelector
											providers={providers}
											selectedProviders={newRule.providers}
											onProvidersChange={(selectedProviders: string[]) =>
												setNewRule((prev) => ({
													...prev,
													providers: selectedProviders,
												}))
											}
											placeholder="Select providers..."
										/>
									</div>
								)}

								{(newRule.ruleType === "allow_pricing" ||
									newRule.ruleType === "deny_pricing") && (
									<>
										<div className="space-y-1">
											<Label
												htmlFor="pricingType"
												className="text-sm font-medium"
											>
												Pricing Type
											</Label>
											<Select
												value={newRule.pricingType}
												onValueChange={(value) =>
													setNewRule((prev) => ({
														...prev,
														pricingType: value,
													}))
												}
											>
												<SelectTrigger className="h-9">
													<SelectValue placeholder="Select pricing type" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="any">Any</SelectItem>
													<SelectItem value="free">Free Only</SelectItem>
													<SelectItem value="paid">Paid Only</SelectItem>
												</SelectContent>
											</Select>
										</div>
										{newRule.pricingType !== "free" && (
											<>
												<div className="space-y-1">
													<Label
														htmlFor="maxInputPrice"
														className="text-sm font-medium"
													>
														Max Input Price ($/M tokens)
													</Label>
													<Input
														id="maxInputPrice"
														type="number"
														step="0.000001"
														className="h-9"
														value={newRule.maxInputPrice}
														onChange={(e) =>
															setNewRule((prev) => ({
																...prev,
																maxInputPrice: e.target.value,
															}))
														}
														placeholder="0.002500"
													/>
												</div>
												<div className="space-y-1">
													<Label
														htmlFor="maxOutputPrice"
														className="text-sm font-medium"
													>
														Max Output Price ($/M tokens)
													</Label>
													<Input
														id="maxOutputPrice"
														type="number"
														step="0.000001"
														className="h-9"
														value={newRule.maxOutputPrice}
														onChange={(e) =>
															setNewRule((prev) => ({
																...prev,
																maxOutputPrice: e.target.value,
															}))
														}
														placeholder="0.010000"
													/>
												</div>
											</>
										)}
									</>
								)}
							</div>

							<Button
								onClick={handleCreateRule}
								disabled={
									Boolean(isCreating) ||
									!newRule.ruleType ||
									(newRule.ruleType.includes("models") &&
										newRule.models.length === 0) ||
									(newRule.ruleType.includes("providers") &&
										newRule.providers.length === 0) ||
									(newRule.ruleType.includes("pricing") &&
										!newRule.pricingType &&
										!newRule.maxInputPrice &&
										!newRule.maxOutputPrice)
								}
								className="w-full md:w-auto"
							>
								<Plus className="mr-2 h-4 w-4" />
								{isCreating ? "Creating..." : "Create Rule"}
							</Button>
						</CardContent>
					</Card>

					{/* Existing rules */}
					<Card className="border-border/50 shadow-sm">
						<CardHeader className="space-y-1 pb-3">
							<div className="flex items-center gap-2">
								<Lock className="h-4 w-4 text-primary" />
								<CardTitle className="text-lg">Existing Rules</CardTitle>
							</div>
							<CardDescription className="text-sm">
								Manage the access control rules for this API key.
							</CardDescription>
						</CardHeader>
						<CardContent>
							{isLoading ? (
								<div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
									Loading rules...
								</div>
							) : !rulesData?.rules || rulesData.rules.length === 0 ? (
								<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 py-12">
									<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
										<Shield className="h-6 w-6 text-muted-foreground" />
									</div>
									<h3 className="mb-1 text-sm font-medium">
										No IAM rules configured
									</h3>
									<p className="text-center text-sm text-muted-foreground">
										All models are accessible. Create a rule above to restrict
										access.
									</p>
								</div>
							) : (
								<div className="space-y-2.5">
									{rulesData.rules.map((rule: IamRule) => (
										<div
											key={rule.id}
											className="group flex items-start gap-3 rounded-lg border border-border/50 bg-card p-3 transition-all hover:border-border hover:shadow-sm"
										>
											<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
												{rule.ruleType.startsWith("allow") ? (
													<CheckCircle2 className="h-4 w-4 text-green-500" />
												) : (
													<AlertCircle className="h-4 w-4 text-red-500" />
												)}
											</div>
											<div className="min-w-0 flex-1 space-y-1.5">
												<div className="flex items-start justify-between gap-4">
													<div className="space-y-1">
														<div className="flex items-center gap-2">
															<Badge
																variant={getRuleTypeColor(rule.ruleType)}
																className="text-xs font-medium"
															>
																{getRuleTypeLabel(rule.ruleType)}
															</Badge>
															<Badge
																variant="outline"
																className="text-xs font-normal"
															>
																{rule.status}
															</Badge>
														</div>
														<p className="text-sm text-muted-foreground">
															{formatRuleValue(rule)}
														</p>
													</div>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDeleteRule(rule.id)}
														className="h-8 w-8 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
													>
														<Trash2 className="h-4 w-4" />
														<span className="sr-only">Delete rule</span>
													</Button>
												</div>
												<p className="text-xs text-muted-foreground">
													Created{" "}
													{new Date(rule.createdAt).toLocaleDateString(
														"en-US",
														{
															year: "numeric",
															month: "short",
															day: "numeric",
														},
													)}
												</p>
											</div>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
