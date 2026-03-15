"use client";

import { Plus, Trash2, Save, X } from "lucide-react";
import { useParams } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
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
import { Switch } from "@/lib/components/switch";
import { useFetchClient } from "@/lib/fetch-client";

import { ContactSalesCard } from "./contact-sales-card";

interface SystemRuleConfig {
	enabled: boolean;
	action: "block" | "redact" | "warn" | "allow";
}

interface SystemRulesConfig {
	prompt_injection: SystemRuleConfig;
	jailbreak: SystemRuleConfig;
	pii_detection: SystemRuleConfig;
	secrets: SystemRuleConfig;
	file_types: SystemRuleConfig;
	document_leakage: SystemRuleConfig;
}

interface GuardrailConfig {
	id: string;
	enabled: boolean;
	systemRules: SystemRulesConfig;
	maxFileSizeMb: number;
	allowedFileTypes: string[];
	piiAction: "block" | "redact" | "warn" | "allow";
}

interface CustomRule {
	id: string;
	name: string;
	type: "blocked_terms" | "custom_regex" | "topic_restriction";
	enabled: boolean;
	priority: number;
	action: "block" | "redact" | "warn" | "allow";
	config: Record<string, unknown>;
}

const SYSTEM_RULES = [
	{
		id: "prompt_injection",
		name: "Prompt Injection Detection",
		description:
			"Detect attempts to override system instructions or inject malicious prompts",
	},
	{
		id: "jailbreak",
		name: "Jailbreak Prevention",
		description: "Block attempts to bypass AI safety measures",
	},
	{
		id: "pii_detection",
		name: "PII Detection",
		description:
			"Detect and optionally redact personal identifiable information",
	},
	{
		id: "secrets",
		name: "Secrets Detection",
		description: "Detect API keys, passwords, and other credentials",
	},
	{
		id: "file_types",
		name: "File Type Restrictions",
		description: "Restrict uploads to allowed file types",
	},
	{
		id: "document_leakage",
		name: "Document Leakage Prevention",
		description: "Prevent exposure of confidential document content",
	},
] as const;

export function GuardrailsClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const fetchClient = useFetchClient();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } =
		useTeamMembers(organizationId);

	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;

	const [config, setConfig] = useState<GuardrailConfig | null>(null);
	const [customRules, setCustomRules] = useState<CustomRule[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);

	// Edit state for custom rules
	const [showAddRule, setShowAddRule] = useState(false);
	const [newRule, setNewRule] = useState({
		name: "",
		type: "blocked_terms" as
			| "blocked_terms"
			| "custom_regex"
			| "topic_restriction",
		action: "block" as "block" | "redact" | "warn" | "allow",
		terms: "",
		pattern: "",
		topics: "",
	});

	const canManageGuardrails =
		selectedOrganization?.plan === "enterprise" &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	const defaultConfig: GuardrailConfig = {
		id: "",
		enabled: false,
		systemRules: {
			prompt_injection: { enabled: true, action: "block" },
			jailbreak: { enabled: true, action: "block" },
			pii_detection: { enabled: true, action: "redact" },
			secrets: { enabled: true, action: "block" },
			file_types: { enabled: true, action: "block" },
			document_leakage: { enabled: false, action: "warn" },
		},
		maxFileSizeMb: 10,
		allowedFileTypes: ["pdf", "txt", "md", "csv", "json", "xml"],
		piiAction: "redact",
	};

	const fetchConfig = useCallback(async () => {
		try {
			setIsLoading(true);
			const response = await fetchClient.GET(
				"/guardrails/config/{organizationId}",
				{
					params: { path: { organizationId } },
				},
			);

			if (response.data) {
				setConfig(response.data as unknown as GuardrailConfig);
			} else {
				// No config exists yet, use defaults
				setConfig(defaultConfig);
			}

			const rulesResponse = await fetchClient.GET(
				"/guardrails/rules/{organizationId}",
				{
					params: { path: { organizationId } },
				},
			);

			if (rulesResponse.data) {
				setCustomRules(
					(rulesResponse.data as { rules: CustomRule[] }).rules || [],
				);
			}
		} catch {
			setError("Failed to load guardrails configuration");
		} finally {
			setIsLoading(false);
		}
	}, [fetchClient, organizationId]);

	useEffect(() => {
		if (canManageGuardrails) {
			void fetchConfig();
		} else {
			setIsLoading(false);
		}
	}, [canManageGuardrails, fetchConfig]);

	const saveConfig = async () => {
		if (!config) {
			return;
		}

		try {
			setIsSaving(true);
			setError(null);
			setSuccess(null);

			await fetchClient.PUT("/guardrails/config/{organizationId}", {
				params: { path: { organizationId } },
				body: {
					enabled: config.enabled,
					systemRules: config.systemRules,
					maxFileSizeMb: config.maxFileSizeMb,
					allowedFileTypes: config.allowedFileTypes,
					piiAction: config.piiAction,
				},
			});

			setSuccess("Configuration saved successfully");
			setTimeout(() => setSuccess(null), 3000);
		} catch {
			setError("Failed to save configuration");
		} finally {
			setIsSaving(false);
		}
	};

	const updateSystemRule = (
		ruleId: keyof SystemRulesConfig,
		field: keyof SystemRuleConfig,
		value: boolean | string,
	) => {
		if (!config) {
			return;
		}

		setConfig({
			...config,
			systemRules: {
				...config.systemRules,
				[ruleId]: {
					...config.systemRules[ruleId],
					[field]: value,
				},
			},
		});
	};

	const addCustomRule = async () => {
		try {
			setError(null);

			let ruleConfig:
				| {
						type: "blocked_terms";
						terms: string[];
						matchType: "exact" | "contains" | "regex";
						caseSensitive: boolean;
				  }
				| { type: "custom_regex"; pattern: string }
				| { type: "topic_restriction"; blockedTopics: string[] };

			if (newRule.type === "blocked_terms") {
				ruleConfig = {
					type: "blocked_terms",
					terms: newRule.terms.split("\n").filter((t) => t.trim()),
					matchType: "contains",
					caseSensitive: false,
				};
			} else if (newRule.type === "custom_regex") {
				ruleConfig = {
					type: "custom_regex",
					pattern: newRule.pattern,
				};
			} else {
				ruleConfig = {
					type: "topic_restriction",
					blockedTopics: newRule.topics.split("\n").filter((t) => t.trim()),
				};
			}

			const response = await fetchClient.POST(
				"/guardrails/rules/{organizationId}",
				{
					params: { path: { organizationId } },
					body: {
						name: newRule.name,
						type: newRule.type,
						action: newRule.action,
						config: ruleConfig,
						enabled: true,
						priority: customRules.length + 1,
					},
				},
			);

			if (response.data) {
				setCustomRules([...customRules, response.data as CustomRule]);
				setShowAddRule(false);
				setNewRule({
					name: "",
					type: "blocked_terms",
					action: "block",
					terms: "",
					pattern: "",
					topics: "",
				});
			}
		} catch {
			setError("Failed to add rule");
		}
	};

	const deleteCustomRule = async (ruleId: string) => {
		try {
			await fetchClient.DELETE("/guardrails/rules/{organizationId}/{ruleId}", {
				params: { path: { organizationId, ruleId } },
			});

			setCustomRules(customRules.filter((r) => r.id !== ruleId));
		} catch {
			setError("Failed to delete rule");
		}
	};

	const toggleRuleEnabled = async (rule: CustomRule) => {
		try {
			await fetchClient.PATCH("/guardrails/rules/{organizationId}/{ruleId}", {
				params: { path: { organizationId, ruleId: rule.id } },
				body: { enabled: !rule.enabled },
			});

			setCustomRules(
				customRules.map((r) =>
					r.id === rule.id ? { ...r, enabled: !r.enabled } : r,
				),
			);
		} catch {
			setError("Failed to update rule");
		}
	};

	if (selectedOrganization?.plan !== "enterprise") {
		return <ContactSalesCard />;
	}

	if (isLoadingTeam || !currentUserRole) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	if (currentUserRole !== "owner" && currentUserRole !== "admin") {
		return (
			<Card>
				<CardHeader>
					<CardTitle>Access Denied</CardTitle>
					<CardDescription>
						Only organization owners and admins can manage guardrails.
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{error && (
				<div className="p-4 text-sm text-red-800 bg-red-100 rounded-lg dark:bg-red-900/20 dark:text-red-400">
					{error}
				</div>
			)}

			{success && (
				<div className="p-4 text-sm text-green-800 bg-green-100 rounded-lg dark:bg-green-900/20 dark:text-green-400">
					{success}
				</div>
			)}

			{/* Main Toggle */}
			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<div>
							<CardTitle>Guardrails</CardTitle>
							<CardDescription>
								Configure content safety rules for your LLM applications
							</CardDescription>
						</div>
						{config && (
							<div className="flex items-center gap-4">
								<div className="flex items-center gap-2">
									<Switch
										checked={config.enabled}
										onCheckedChange={(enabled) =>
											setConfig({ ...config, enabled })
										}
									/>
									<Label>{config.enabled ? "Enabled" : "Disabled"}</Label>
								</div>
								<Button onClick={saveConfig} disabled={isSaving}>
									<Save className="h-4 w-4 mr-2" />
									{isSaving ? "Saving..." : "Save Changes"}
								</Button>
							</div>
						)}
					</div>
				</CardHeader>
			</Card>

			{config && (
				<div
					className={
						config.enabled ? "" : "opacity-60 pointer-events-none select-none"
					}
				>
					{/* System Rules */}
					<Card className="mb-6">
						<CardHeader>
							<CardTitle>System Rules</CardTitle>
							<CardDescription>
								Built-in security rules powered by pattern matching
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							{SYSTEM_RULES.map((rule) => {
								const ruleConfig =
									config.systemRules[rule.id as keyof SystemRulesConfig];
								return (
									<div
										key={rule.id}
										className="flex items-center justify-between p-4 border rounded-lg"
									>
										<div className="flex items-center gap-4">
											<Switch
												checked={ruleConfig?.enabled ?? false}
												disabled={!config.enabled}
												onCheckedChange={(enabled) =>
													updateSystemRule(
														rule.id as keyof SystemRulesConfig,
														"enabled",
														enabled,
													)
												}
											/>
											<div>
												<div className="font-medium">{rule.name}</div>
												<div className="text-sm text-muted-foreground">
													{rule.description}
												</div>
											</div>
										</div>
										{ruleConfig?.enabled && (
											<Select
												value={ruleConfig.action}
												disabled={!config.enabled}
												onValueChange={(value) =>
													updateSystemRule(
														rule.id as keyof SystemRulesConfig,
														"action",
														value,
													)
												}
											>
												<SelectTrigger className="w-32">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="block">Block</SelectItem>
													{rule.id === "pii_detection" && (
														<SelectItem value="redact">Redact</SelectItem>
													)}
													<SelectItem value="warn">Warn</SelectItem>
													<SelectItem value="allow">Allow</SelectItem>
												</SelectContent>
											</Select>
										)}
									</div>
								);
							})}
						</CardContent>
					</Card>

					{/* File Restrictions */}
					<Card className="mb-6">
						<CardHeader>
							<CardTitle>File Restrictions</CardTitle>
							<CardDescription>
								Configure allowed file types and size limits
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label>Maximum File Size (MB)</Label>
								<Input
									type="number"
									value={config.maxFileSizeMb}
									disabled={!config.enabled}
									onChange={(e) =>
										setConfig({
											...config,
											maxFileSizeMb: parseInt(e.target.value, 10) || 10,
										})
									}
									className="w-32"
								/>
							</div>
							<div className="space-y-2">
								<Label>Allowed File Types</Label>
								<div className="flex flex-wrap gap-2">
									{config.allowedFileTypes.map((type) => (
										<Badge key={type} variant="secondary">
											{type}
											{config.enabled && (
												<button
													onClick={() =>
														setConfig({
															...config,
															allowedFileTypes: config.allowedFileTypes.filter(
																(t) => t !== type,
															),
														})
													}
													className="ml-1 hover:text-destructive"
												>
													<X className="h-3 w-3" />
												</button>
											)}
										</Badge>
									))}
								</div>
								<div className="flex gap-2">
									<Input
										placeholder="Add file type (e.g., pdf)"
										id="newFileType"
										className="w-48"
										disabled={!config.enabled}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												const input = e.currentTarget;
												const value = input.value.trim().toLowerCase();
												if (value && !config.allowedFileTypes.includes(value)) {
													setConfig({
														...config,
														allowedFileTypes: [
															...config.allowedFileTypes,
															value,
														],
													});
													input.value = "";
												}
											}
										}}
									/>
								</div>
							</div>
						</CardContent>
					</Card>

					{/* Custom Rules */}
					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle>Custom Rules</CardTitle>
									<CardDescription>
										Create custom content filtering rules
									</CardDescription>
								</div>
								<Button
									onClick={() => setShowAddRule(true)}
									variant="outline"
									disabled={!config.enabled}
								>
									<Plus className="h-4 w-4 mr-2" />
									Add Rule
								</Button>
							</div>
						</CardHeader>
						<CardContent className="space-y-4">
							{showAddRule && config.enabled && (
								<div className="p-4 border rounded-lg space-y-4 bg-muted/50">
									<div className="flex items-center justify-between">
										<h4 className="font-medium">New Rule</h4>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => setShowAddRule(false)}
										>
											<X className="h-4 w-4" />
										</Button>
									</div>
									<div className="grid gap-4 md:grid-cols-2">
										<div className="space-y-2">
											<Label>Rule Name</Label>
											<Input
												value={newRule.name}
												onChange={(e) =>
													setNewRule({ ...newRule, name: e.target.value })
												}
												placeholder="e.g., Block competitors"
											/>
										</div>
										<div className="space-y-2">
											<Label>Rule Type</Label>
											<Select
												value={newRule.type}
												onValueChange={(value) =>
													setNewRule({
														...newRule,
														type: value as typeof newRule.type,
													})
												}
											>
												<SelectTrigger>
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="blocked_terms">
														Blocked Terms
													</SelectItem>
													<SelectItem value="custom_regex">
														Custom Regex
													</SelectItem>
													<SelectItem value="topic_restriction">
														Topic Restriction
													</SelectItem>
												</SelectContent>
											</Select>
										</div>
									</div>
									<div className="space-y-2">
										<Label>Action</Label>
										<Select
											value={newRule.action}
											onValueChange={(value) =>
												setNewRule({
													...newRule,
													action: value as typeof newRule.action,
												})
											}
										>
											<SelectTrigger className="w-48">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="block">Block</SelectItem>
												<SelectItem value="warn">Warn</SelectItem>
												<SelectItem value="allow">Allow (Log Only)</SelectItem>
											</SelectContent>
										</Select>
									</div>
									{newRule.type === "blocked_terms" && (
										<div className="space-y-2">
											<Label>Blocked Terms (one per line)</Label>
											<textarea
												value={newRule.terms}
												onChange={(e) =>
													setNewRule({ ...newRule, terms: e.target.value })
												}
												className="w-full h-24 px-3 py-2 text-sm border rounded-md resize-none"
												placeholder="competitor&#10;secret project&#10;confidential"
											/>
										</div>
									)}
									{newRule.type === "custom_regex" && (
										<div className="space-y-2">
											<Label>Regex Pattern</Label>
											<Input
												value={newRule.pattern}
												onChange={(e) =>
													setNewRule({ ...newRule, pattern: e.target.value })
												}
												placeholder="e.g., \\b\\d{3}-\\d{2}-\\d{4}\\b"
											/>
										</div>
									)}
									{newRule.type === "topic_restriction" && (
										<div className="space-y-2">
											<Label>Restricted Topics (one per line)</Label>
											<textarea
												value={newRule.topics}
												onChange={(e) =>
													setNewRule({ ...newRule, topics: e.target.value })
												}
												className="w-full h-24 px-3 py-2 text-sm border rounded-md resize-none"
												placeholder="politics&#10;religion&#10;violence"
											/>
										</div>
									)}
									<div className="flex justify-end gap-2">
										<Button
											variant="outline"
											onClick={() => setShowAddRule(false)}
										>
											Cancel
										</Button>
										<Button onClick={addCustomRule} disabled={!newRule.name}>
											Add Rule
										</Button>
									</div>
								</div>
							)}

							{customRules.length === 0 && !showAddRule && (
								<div className="text-center py-8 text-muted-foreground">
									No custom rules configured.
									{config.enabled
										? ' Click "Add Rule" to create one.'
										: " Enable guardrails to add rules."}
								</div>
							)}

							{customRules.map((rule) => (
								<div
									key={rule.id}
									className="flex items-center justify-between p-4 border rounded-lg"
								>
									<div className="flex items-center gap-4">
										<Switch
											checked={rule.enabled}
											disabled={!config.enabled}
											onCheckedChange={() => toggleRuleEnabled(rule)}
										/>
										<div>
											<div className="flex items-center gap-2">
												<span className="font-medium">{rule.name}</span>
												<Badge variant="outline" className="text-xs">
													{rule.type.replace("_", " ")}
												</Badge>
											</div>
											<div className="text-sm text-muted-foreground">
												Action: {rule.action}
											</div>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="ghost"
											size="sm"
											disabled={!config.enabled}
											onClick={() => deleteCustomRule(rule.id)}
											className="text-destructive hover:text-destructive"
										>
											<Trash2 className="h-4 w-4" />
										</Button>
									</div>
								</div>
							))}
						</CardContent>
					</Card>
				</div>
			)}
		</div>
	);
}
