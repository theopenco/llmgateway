"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Plus, Shield, Trash2 } from "lucide-react";
import { useState } from "react";

import { MultiModelSelector } from "@/components/api-keys/multi-model-selector";
import { MultiProviderSelector } from "@/components/api-keys/multi-provider-selector";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
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

import type { ApiKey } from "@/lib/types";

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

interface IamRulesDialogProps {
	apiKey: ApiKey;
	children: React.ReactNode;
}

export function IamRulesDialog({ apiKey, children }: IamRulesDialogProps) {
	const [open, setOpen] = useState(false);
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
		{
			enabled: open,
		},
	);

	// Mutations
	const { mutate: createRule } = api.useMutation("post", "/keys/api/{id}/iam");
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
					queryClient.invalidateQueries({
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
				onError: (error: any) => {
					const errorMessage =
						error?.error?.message ||
						error?.message ||
						(error instanceof Error
							? error.message
							: "Failed to create IAM rule");
					toast({
						title: "Failed to create IAM rule",
						description: errorMessage,
						variant: "destructive",
					});
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
					queryClient.invalidateQueries({
						queryKey: api.queryOptions("get", "/keys/api/{id}/iam", {
							params: { path: { id: apiKey.id } },
						}).queryKey,
					});

					toast({ title: "IAM rule deleted successfully" });
				},
				onError: (error: any) => {
					const errorMessage =
						error?.error?.message ||
						error?.message ||
						(error instanceof Error
							? error.message
							: "Failed to delete IAM rule");
					toast({
						title: errorMessage,
						variant: "destructive",
					});
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

	const getRuleTypeColor = (ruleType: string) => {
		if (ruleType.startsWith("allow")) {
			return "default";
		}
		if (ruleType.startsWith("deny")) {
			return "destructive";
		}
		return "secondary";
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Shield className="h-5 w-5" />
						IAM Rules - {apiKey.description}
					</DialogTitle>
					<DialogDescription>
						Configure access control rules for this API key to restrict model
						access by type, provider, or pricing.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-6">
					{/* Create new rule form */}
					<div className="border rounded-lg p-4 space-y-4">
						<h3 className="font-medium">Create New Rule</h3>

						<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
							<div>
								<Label htmlFor="ruleType">Rule Type</Label>
								<Select
									value={newRule.ruleType}
									onValueChange={(value) =>
										setNewRule((prev) => ({
											...prev,
											ruleType: value as IamRule["ruleType"],
										}))
									}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="allow_models">
											Allow Specific Models
										</SelectItem>
										<SelectItem value="deny_models">
											Deny Specific Models
										</SelectItem>
										<SelectItem value="allow_providers">
											Allow Specific Providers
										</SelectItem>
										<SelectItem value="deny_providers">
											Deny Specific Providers
										</SelectItem>
										<SelectItem value="allow_pricing">
											Allow Pricing Constraints
										</SelectItem>
										<SelectItem value="deny_pricing">
											Deny Pricing Constraints
										</SelectItem>
									</SelectContent>
								</Select>
							</div>

							{(newRule.ruleType === "allow_models" ||
								newRule.ruleType === "deny_models") && (
								<div>
									<Label htmlFor="models">Models</Label>
									<MultiModelSelector
										selectedModels={newRule.models}
										onModelsChange={(models) =>
											setNewRule((prev) => ({
												...prev,
												models,
											}))
										}
										placeholder="Select models..."
									/>
								</div>
							)}

							{(newRule.ruleType === "allow_providers" ||
								newRule.ruleType === "deny_providers") && (
								<div>
									<Label htmlFor="providers">Providers</Label>
									<MultiProviderSelector
										selectedProviders={newRule.providers}
										onProvidersChange={(providers) =>
											setNewRule((prev) => ({
												...prev,
												providers,
											}))
										}
										placeholder="Select providers..."
									/>
								</div>
							)}

							{(newRule.ruleType === "allow_pricing" ||
								newRule.ruleType === "deny_pricing") && (
								<>
									<div>
										<Label htmlFor="pricingType">Pricing Type</Label>
										<Select
											value={newRule.pricingType}
											onValueChange={(value) =>
												setNewRule((prev) => ({ ...prev, pricingType: value }))
											}
										>
											<SelectTrigger>
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
											<div>
												<Label htmlFor="maxInputPrice">
													Max Input Price ($/M tokens)
												</Label>
												<Input
													id="maxInputPrice"
													type="number"
													step="0.000001"
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
											<div>
												<Label htmlFor="maxOutputPrice">
													Max Output Price ($/M tokens)
												</Label>
												<Input
													id="maxOutputPrice"
													type="number"
													step="0.000001"
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
							className="w-full"
							disabled={
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
						>
							<Plus className="h-4 w-4 mr-2" />
							Create Rule
						</Button>
					</div>

					{/* Existing rules table */}
					<div>
						<h3 className="font-medium mb-4">Existing Rules</h3>
						{isLoading ? (
							<div className="text-center py-8 text-muted-foreground">
								Loading rules...
							</div>
						) : !rulesData?.rules || rulesData.rules.length === 0 ? (
							<div className="text-center py-8 text-muted-foreground">
								No IAM rules configured. All models are accessible.
							</div>
						) : (
							<div className="border rounded-lg">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>Rule Type</TableHead>
											<TableHead>Configuration</TableHead>
											<TableHead>Status</TableHead>
											<TableHead>Created</TableHead>
											<TableHead className="text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{rulesData.rules.map((rule: IamRule) => (
											<TableRow key={rule.id}>
												<TableCell>
													<Badge variant={getRuleTypeColor(rule.ruleType)}>
														{rule.ruleType.replace("_", " ").toUpperCase()}
													</Badge>
												</TableCell>
												<TableCell className="max-w-xs">
													<div className="truncate text-sm">
														{formatRuleValue(rule)}
													</div>
												</TableCell>
												<TableCell>
													<Badge
														variant={
															rule.status === "active" ? "default" : "secondary"
														}
													>
														{rule.status}
													</Badge>
												</TableCell>
												<TableCell className="text-sm text-muted-foreground">
													{new Date(rule.createdAt).toLocaleDateString()}
												</TableCell>
												<TableCell className="text-right">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDeleteRule(rule.id)}
														className="text-destructive hover:text-destructive"
													>
														<Trash2 className="h-4 w-4" />
													</Button>
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
