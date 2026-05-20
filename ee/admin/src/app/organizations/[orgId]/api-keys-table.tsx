"use client";

import { ChevronDown, ChevronRight, Shield } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import type { paths } from "@/lib/api/v1";

type ApiKeysResponse =
	paths["/admin/organizations/{orgId}/api-keys"]["get"]["responses"]["200"]["content"]["application/json"];
type ApiKey = ApiKeysResponse["apiKeys"][number];
type IamRule = ApiKey["iamRules"][number];

const creditsFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

function formatRuleType(type: string) {
	return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ruleTypeBadgeVariant(
	type: IamRule["ruleType"],
): "default" | "secondary" | "outline" | "destructive" {
	if (type.startsWith("deny_")) {
		return "destructive";
	}
	return "secondary";
}

function formatRuleValue(rule: IamRule): string {
	const v = rule.ruleValue;
	if (v.models?.length) {
		return `models: ${v.models.join(", ")}`;
	}
	if (v.providers?.length) {
		return `providers: ${v.providers.join(", ")}`;
	}
	if (v.pricingType) {
		const parts = [`pricing: ${v.pricingType}`];
		if (typeof v.maxInputPrice === "number") {
			parts.push(`maxInput: ${v.maxInputPrice}`);
		}
		if (typeof v.maxOutputPrice === "number") {
			parts.push(`maxOutput: ${v.maxOutputPrice}`);
		}
		return parts.join(", ");
	}
	return "—";
}

interface ApiKeysTableProps {
	apiKeys: ApiKey[];
	orgId: string;
	txPage: number;
	akPage: number;
	akOffset: number;
	akLimit: number;
	akTotal: number;
	akTotalPages: number;
}

export function ApiKeysTable({
	apiKeys,
	orgId,
	txPage,
	akPage,
	akOffset,
	akLimit,
	akTotal,
	akTotalPages,
}: ApiKeysTableProps) {
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	const toggle = (id: string) => {
		setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	return (
		<div className="space-y-4">
			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-10" />
							<TableHead>Token</TableHead>
							<TableHead>Description</TableHead>
							<TableHead>Project</TableHead>
							<TableHead>Usage</TableHead>
							<TableHead>IAM Rules</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{apiKeys.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={8}
									className="h-24 text-center text-muted-foreground"
								>
									No API keys found
								</TableCell>
							</TableRow>
						) : (
							apiKeys.map((apiKey) => {
								const isOpen = !!expanded[apiKey.id];
								const ruleCount = apiKey.iamRules.length;
								return (
									<Fragment key={apiKey.id}>
										<TableRow>
											<TableCell>
												<Button
													variant="ghost"
													size="sm"
													className="h-8 w-8 p-0"
													disabled={ruleCount === 0}
													onClick={() => toggle(apiKey.id)}
													aria-label={
														isOpen ? "Collapse IAM rules" : "Expand IAM rules"
													}
												>
													{ruleCount === 0 ? (
														<ChevronRight className="h-4 w-4 opacity-30" />
													) : isOpen ? (
														<ChevronDown className="h-4 w-4" />
													) : (
														<ChevronRight className="h-4 w-4" />
													)}
												</Button>
											</TableCell>
											<TableCell className="font-mono text-xs">
												{apiKey.token.slice(0, 12)}...
											</TableCell>
											<TableCell className="max-w-[200px] truncate">
												{apiKey.description ?? "—"}
											</TableCell>
											<TableCell>
												<span className="text-sm">{apiKey.projectName}</span>
												<p className="text-xs text-muted-foreground">
													{apiKey.projectId}
												</p>
											</TableCell>
											<TableCell className="tabular-nums text-sm">
												{creditsFormatter.format(parseFloat(apiKey.usage))}
												{apiKey.usageLimit && (
													<span className="text-muted-foreground">
														{" "}
														/{" "}
														{creditsFormatter.format(
															parseFloat(apiKey.usageLimit),
														)}
													</span>
												)}
											</TableCell>
											<TableCell>
												<Badge
													variant={ruleCount > 0 ? "secondary" : "outline"}
													className="gap-1"
												>
													<Shield className="h-3 w-3" />
													{ruleCount}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge
													variant={
														apiKey.status === "active" ? "secondary" : "outline"
													}
												>
													{apiKey.status ?? "active"}
												</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{formatDate(apiKey.createdAt)}
											</TableCell>
										</TableRow>
										{isOpen && ruleCount > 0 && (
											<TableRow className="bg-muted/30 hover:bg-muted/30">
												<TableCell />
												<TableCell colSpan={7} className="py-3">
													<div className="space-y-2">
														<div className="text-xs font-medium text-muted-foreground">
															IAM Rules ({ruleCount})
														</div>
														<div className="overflow-hidden rounded-md border border-border/60 bg-background">
															<Table>
																<TableHeader>
																	<TableRow>
																		<TableHead>Type</TableHead>
																		<TableHead>Value</TableHead>
																		<TableHead>Status</TableHead>
																		<TableHead>Created</TableHead>
																	</TableRow>
																</TableHeader>
																<TableBody>
																	{apiKey.iamRules.map((rule) => (
																		<TableRow key={rule.id}>
																			<TableCell>
																				<Badge
																					variant={ruleTypeBadgeVariant(
																						rule.ruleType,
																					)}
																				>
																					{formatRuleType(rule.ruleType)}
																				</Badge>
																			</TableCell>
																			<TableCell className="text-xs text-muted-foreground">
																				{formatRuleValue(rule)}
																			</TableCell>
																			<TableCell>
																				<Badge
																					variant={
																						rule.status === "active"
																							? "secondary"
																							: "outline"
																					}
																				>
																					{rule.status}
																				</Badge>
																			</TableCell>
																			<TableCell className="text-xs text-muted-foreground">
																				{formatDate(rule.createdAt)}
																			</TableCell>
																		</TableRow>
																	))}
																</TableBody>
															</Table>
														</div>
													</div>
												</TableCell>
											</TableRow>
										)}
									</Fragment>
								);
							})
						)}
					</TableBody>
				</Table>
			</div>

			{akTotalPages > 1 && (
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {akOffset + 1} to {Math.min(akOffset + akLimit, akTotal)} of{" "}
						{akTotal}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={akPage <= 1}>
							<Link
								href={`/organizations/${orgId}?tab=api-keys&txPage=${txPage}&akPage=${akPage - 1}`}
								className={akPage <= 1 ? "pointer-events-none opacity-50" : ""}
							>
								Previous
							</Link>
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {akPage} of {akTotalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							asChild
							disabled={akPage >= akTotalPages}
						>
							<Link
								href={`/organizations/${orgId}?tab=api-keys&txPage=${txPage}&akPage=${akPage + 1}`}
								className={
									akPage >= akTotalPages ? "pointer-events-none opacity-50" : ""
								}
							>
								Next
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
