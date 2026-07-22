"use client";

import {
	AlertCircle,
	CheckCircle2,
	Lock,
	Network,
	Plus,
	Shield,
	Trash2,
	Zap,
} from "lucide-react";
import { useState } from "react";

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

import { models, providers } from "@llmgateway/models";
import {
	MultiModelSelector,
	MultiProviderSelector,
} from "@llmgateway/shared/components";

import type { ReactNode } from "react";

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
		| "deny_providers"
		| "allow_ip_cidrs"
		| "deny_ip_cidrs";
	ruleValue: {
		models?: string[];
		providers?: string[];
		pricingType?: "free" | "paid";
		maxInputPrice?: number;
		maxOutputPrice?: number;
		ipCidrs?: string[];
	};
	status: "active" | "inactive";
}

const IPV4_OR_IPV6_CIDR =
	/^([0-9]{1,3}(\.[0-9]{1,3}){3}|[0-9a-fA-F:]+)\/[0-9]{1,3}$/;

function parseCidrList(input: string): string[] {
	return input
		.split(/[\s,]+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

function isValidCidrSyntax(cidr: string): boolean {
	return IPV4_OR_IPV6_CIDR.test(cidr);
}

export function formatRuleValue(rule: Pick<IamRule, "ruleType" | "ruleValue">) {
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
	if (ruleType.includes("ip_cidrs") && ruleValue.ipCidrs) {
		return ruleValue.ipCidrs.join(", ");
	}

	return "No constraints";
}

function getRuleTypeLabel(ruleType: string) {
	return ruleType.replaceAll("_", " ").toUpperCase();
}

function getRuleTypeColor(ruleType: string) {
	if (ruleType.startsWith("allow")) {
		return "default" as const;
	}
	if (ruleType.startsWith("deny")) {
		return "destructive" as const;
	}
	return "secondary" as const;
}

export interface IamRulesEditorProps {
	rules: IamRule[] | undefined;
	isLoading: boolean;
	isEnterprise: boolean;
	onCreateRule: (
		rule: {
			ruleType: IamRule["ruleType"];
			ruleValue: IamRule["ruleValue"];
			status: "active";
		},
		callbacks: { onSuccess: () => void },
	) => void;
	isCreating: boolean;
	onDeleteRule: (ruleId: string) => void;
	readOnly?: boolean;
	createDescription?: ReactNode;
	listDescription?: ReactNode;
	emptyMessage?: string;
}

export function IamRulesEditor({
	rules,
	isLoading,
	isEnterprise,
	onCreateRule,
	isCreating,
	onDeleteRule,
	readOnly = false,
	createDescription = "Add access control rules to restrict model access by type, provider, or pricing.",
	listDescription = "Manage the configured access control rules.",
	emptyMessage = "All models are accessible. Create a rule above to restrict access.",
}: IamRulesEditorProps) {
	const [newRule, setNewRule] = useState<{
		ruleType: IamRule["ruleType"];
		models: string[];
		providers: string[];
		pricingType: string;
		maxInputPrice: string;
		maxOutputPrice: string;
		ipCidrs: string;
	}>({
		ruleType: "allow_models",
		models: [],
		providers: [],
		pricingType: "",
		maxInputPrice: "",
		maxOutputPrice: "",
		ipCidrs: "",
	});

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
		if (newRule.ruleType.includes("ip_cidrs")) {
			const cidrs = parseCidrList(newRule.ipCidrs);
			const invalid = cidrs.filter((c) => !isValidCidrSyntax(c));
			if (invalid.length > 0) {
				toast({
					title: "Invalid CIDR",
					description: `Not a valid CIDR: ${invalid.join(", ")}`,
					variant: "destructive",
				});
				return;
			}
			ruleValue.ipCidrs = cidrs;
		}

		onCreateRule(
			{
				ruleType: newRule.ruleType,
				ruleValue,
				status: "active",
			},
			{
				onSuccess: () => {
					setNewRule({
						ruleType: "allow_models",
						models: [],
						providers: [],
						pricingType: "",
						maxInputPrice: "",
						maxOutputPrice: "",
						ipCidrs: "",
					});
				},
			},
		);
	};

	return (
		<div className="space-y-5">
			{!readOnly && (
				<Card className="border-border/50 shadow-sm">
					<CardHeader className="space-y-0.5 pb-2">
						<div className="flex items-center gap-2">
							<Plus className="h-4 w-4 text-primary" />
							<CardTitle className="text-lg">Create New Rule</CardTitle>
						</div>
						<CardDescription className="text-sm">
							{createDescription}
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
										<SelectItem value="allow_ip_cidrs" disabled={!isEnterprise}>
											<div className="flex items-center gap-2">
												<Network className="h-4 w-4 text-blue-500" />
												Allow IP Ranges (CIDR)
												{!isEnterprise && (
													<Badge variant="outline" className="text-[10px]">
														Enterprise
													</Badge>
												)}
											</div>
										</SelectItem>
										<SelectItem value="deny_ip_cidrs" disabled={!isEnterprise}>
											<div className="flex items-center gap-2">
												<Network className="h-4 w-4 text-blue-500" />
												Deny IP Ranges (CIDR)
												{!isEnterprise && (
													<Badge variant="outline" className="text-[10px]">
														Enterprise
													</Badge>
												)}
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

							{(newRule.ruleType === "allow_ip_cidrs" ||
								newRule.ruleType === "deny_ip_cidrs") && (
								<div className="space-y-1 md:col-span-2">
									<Label htmlFor="ipCidrs" className="text-sm font-medium">
										IP Ranges (CIDR)
									</Label>
									<Input
										id="ipCidrs"
										className="h-9 font-mono"
										value={newRule.ipCidrs}
										onChange={(e) =>
											setNewRule((prev) => ({
												...prev,
												ipCidrs: e.target.value,
											}))
										}
										placeholder="192.0.2.0/24, 2001:db8::/32"
									/>
									<p className="text-xs text-muted-foreground">
										Comma or whitespace separated. IPv4 and IPv6 supported. The
										gateway reads the client IP from the first entry in{" "}
										<code>X-Forwarded-For</code> (set by the GCP load balancer).
									</p>
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
									!newRule.maxOutputPrice) ||
								(newRule.ruleType.includes("ip_cidrs") &&
									parseCidrList(newRule.ipCidrs).length === 0)
							}
							className="w-full md:w-auto"
						>
							<Plus className="mr-2 h-4 w-4" />
							{isCreating ? "Creating..." : "Create Rule"}
						</Button>
					</CardContent>
				</Card>
			)}

			<Card className="border-border/50 shadow-sm">
				<CardHeader className="space-y-1 pb-3">
					<div className="flex items-center gap-2">
						<Lock className="h-4 w-4 text-primary" />
						<CardTitle className="text-lg">Existing Rules</CardTitle>
					</div>
					<CardDescription className="text-sm">
						{listDescription}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
							Loading rules...
						</div>
					) : !rules || rules.length === 0 ? (
						<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 py-12">
							<div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
								<Shield className="h-6 w-6 text-muted-foreground" />
							</div>
							<h3 className="mb-1 text-sm font-medium">
								No IAM rules configured
							</h3>
							<p className="text-center text-sm text-muted-foreground">
								{emptyMessage}
							</p>
						</div>
					) : (
						<div className="space-y-2.5">
							{rules.map((rule) => (
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
											{!readOnly && (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => onDeleteRule(rule.id)}
													className="h-8 w-8 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
												>
													<Trash2 className="h-4 w-4" />
													<span className="sr-only">Delete rule</span>
												</Button>
											)}
										</div>
										<p className="text-xs text-muted-foreground">
											Created{" "}
											{new Date(rule.createdAt).toLocaleDateString("en-US", {
												year: "numeric",
												month: "short",
												day: "numeric",
											})}
										</p>
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
