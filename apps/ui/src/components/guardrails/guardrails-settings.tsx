"use client";

import { Building2, Plus, Save, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ContactSalesCard } from "@/components/guardrails/contact-sales-card";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	useCreateGuardrailRule,
	useDeleteGuardrailRule,
	useGuardrailConfig,
	useGuardrailRules,
	useProjectGuardrailOverrides,
	useSaveGuardrailConfig,
	useUpdateGuardrailRule,
} from "@/hooks/useGuardrails";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";
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

import type {
	GuardrailConfig,
	GuardrailRule,
	GuardrailsScope,
} from "@/hooks/useGuardrails";

type SystemRulesConfig = NonNullable<GuardrailConfig["systemRules"]>;
type SystemRuleConfig = SystemRulesConfig["prompt_injection"];
type GuardrailAction = SystemRuleConfig["action"];
type CustomRuleType = GuardrailRule["type"];

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

const DEFAULT_SYSTEM_RULES: SystemRulesConfig = {
	prompt_injection: { enabled: true, action: "block" },
	jailbreak: { enabled: true, action: "block" },
	pii_detection: { enabled: true, action: "redact" },
	secrets: { enabled: true, action: "block" },
	file_types: { enabled: true, action: "block" },
	document_leakage: { enabled: false, action: "warn" },
};

interface DraftConfig {
	inheritOrganization: boolean;
	enabled: boolean;
	systemRules: SystemRulesConfig;
	maxFileSizeMb: number;
	allowedFileTypes: string[];
	piiAction: GuardrailAction;
}

const DEFAULT_DRAFT: DraftConfig = {
	inheritOrganization: true,
	enabled: false,
	systemRules: DEFAULT_SYSTEM_RULES,
	maxFileSizeMb: 10,
	allowedFileTypes: ["pdf", "txt", "md", "csv", "json", "xml"],
	piiAction: "redact",
};

function toDraft(config: GuardrailConfig | null): DraftConfig {
	if (!config) {
		return DEFAULT_DRAFT;
	}

	return {
		inheritOrganization: config.inheritOrganization,
		enabled: config.enabled,
		systemRules: config.systemRules ?? DEFAULT_SYSTEM_RULES,
		maxFileSizeMb: config.maxFileSizeMb,
		allowedFileTypes: config.allowedFileTypes,
		piiAction: config.piiAction ?? "redact",
	};
}

export function GuardrailsSettings({ scope }: { scope: GuardrailsScope }) {
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } = useTeamMembers(
		scope.organizationId,
	);

	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isEnterprise = selectedOrganization?.plan === "enterprise";
	const canManageGuardrails =
		isEnterprise &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	const configQuery = useGuardrailConfig(scope, {
		enabled: canManageGuardrails,
	});
	const rulesQuery = useGuardrailRules(scope, { enabled: canManageGuardrails });

	// A project shows the organization settings it inherits, so both scopes are
	// loaded when the current scope is a project.
	const orgScope: GuardrailsScope = {
		kind: "organization",
		organizationId: scope.organizationId,
	};
	const orgConfigQuery = useGuardrailConfig(orgScope, {
		enabled: canManageGuardrails && scope.kind === "project",
	});
	const orgRulesQuery = useGuardrailRules(orgScope, {
		enabled: canManageGuardrails && scope.kind === "project",
	});

	if (!isEnterprise) {
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
						{scope.kind === "project"
							? "Only project owners and admins can manage guardrails."
							: "Only organization owners and admins can manage guardrails."}
					</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const isLoading =
		configQuery.isLoading ||
		rulesQuery.isLoading ||
		orgConfigQuery.isLoading ||
		orgRulesQuery.isLoading;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	const loadError =
		configQuery.error || rulesQuery.error || orgConfigQuery.error;

	if (loadError) {
		return (
			<div className="p-4 text-sm text-red-800 bg-red-100 rounded-lg dark:bg-red-900/20 dark:text-red-400">
				Failed to load guardrails configuration
			</div>
		);
	}

	return (
		<GuardrailsForm
			// Re-seed the draft whenever the persisted config identity changes.
			key={configQuery.data?.id ?? "new"}
			scope={scope}
			config={configQuery.data ?? null}
			rules={rulesQuery.data ?? []}
			organizationConfig={orgConfigQuery.data ?? null}
			organizationRules={orgRulesQuery.data ?? []}
		/>
	);
}

function GuardrailsForm({
	scope,
	config,
	rules,
	organizationConfig,
	organizationRules,
}: {
	scope: GuardrailsScope;
	config: GuardrailConfig | null;
	rules: GuardrailRule[];
	organizationConfig: GuardrailConfig | null;
	organizationRules: GuardrailRule[];
}) {
	const isProject = scope.kind === "project";
	const [draft, setDraft] = useState<DraftConfig>(() => toDraft(config));
	const [success, setSuccess] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showAddRule, setShowAddRule] = useState(false);
	const [newRule, setNewRule] = useState({
		name: "",
		type: "blocked_terms" as CustomRuleType,
		action: "block" as GuardrailAction,
		terms: "",
		pattern: "",
		topics: "",
	});

	const saveMutation = useSaveGuardrailConfig(scope);
	const createRuleMutation = useCreateGuardrailRule(scope);
	const updateRuleMutation = useUpdateGuardrailRule(scope);
	const deleteRuleMutation = useDeleteGuardrailRule(scope);
	const overridesQuery = useProjectGuardrailOverrides(scope.organizationId, {
		enabled: !isProject,
	});

	// While a project inherits, the organization config is what actually runs, so
	// it is shown read-only instead of the project's own (unused) draft.
	const inherits = isProject && draft.inheritOrganization;
	const shown = inherits ? toDraft(organizationConfig) : draft;
	const shownRules = inherits ? organizationRules : rules;
	const readOnly = inherits;
	const editable = shown.enabled && !readOnly;

	const overrides = overridesQuery.data ?? [];

	const save = async () => {
		setError(null);
		setSuccess(null);
		try {
			await saveMutation.mutateAsync({
				...(isProject
					? { inheritOrganization: draft.inheritOrganization }
					: {}),
				enabled: draft.enabled,
				systemRules: draft.systemRules,
				maxFileSizeMb: draft.maxFileSizeMb,
				allowedFileTypes: draft.allowedFileTypes,
				piiAction: draft.piiAction,
			});
			setSuccess("Configuration saved successfully");
			setTimeout(() => setSuccess(null), 3000);
		} catch {
			setError("Failed to save configuration");
		}
	};

	const updateSystemRule = (
		ruleId: keyof SystemRulesConfig,
		field: keyof SystemRuleConfig,
		value: boolean | string,
	) => {
		setDraft({
			...draft,
			systemRules: {
				...draft.systemRules,
				[ruleId]: { ...draft.systemRules[ruleId], [field]: value },
			},
		});
	};

	const addCustomRule = async () => {
		setError(null);

		const ruleConfig =
			newRule.type === "blocked_terms"
				? {
						type: "blocked_terms" as const,
						terms: newRule.terms.split("\n").filter((t) => t.trim()),
						matchType: "contains" as const,
						caseSensitive: false,
					}
				: newRule.type === "custom_regex"
					? { type: "custom_regex" as const, pattern: newRule.pattern }
					: {
							type: "topic_restriction" as const,
							blockedTopics: newRule.topics.split("\n").filter((t) => t.trim()),
						};

		try {
			await createRuleMutation.mutateAsync({
				name: newRule.name,
				type: newRule.type,
				action: newRule.action,
				config: ruleConfig,
				enabled: true,
				priority: rules.length + 1,
			});
			setShowAddRule(false);
			setNewRule({
				name: "",
				type: "blocked_terms",
				action: "block",
				terms: "",
				pattern: "",
				topics: "",
			});
		} catch {
			setError("Failed to add rule");
		}
	};

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

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
						<div>
							<CardTitle>Guardrails</CardTitle>
							<CardDescription>
								{isProject
									? "Configure content safety rules for this project"
									: "Configure content safety rules for your LLM applications"}
							</CardDescription>
						</div>
						<div className="flex items-center gap-4">
							<div className="flex items-center gap-2">
								<Switch
									checked={shown.enabled}
									disabled={readOnly}
									onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
								/>
								<Label>{shown.enabled ? "Enabled" : "Disabled"}</Label>
							</div>
							<Button onClick={save} disabled={saveMutation.isPending}>
								<Save className="h-4 w-4 mr-2" />
								{saveMutation.isPending ? "Saving..." : "Save Changes"}
							</Button>
						</div>
					</div>
				</CardHeader>
				{isProject && (
					<CardContent>
						<div className="flex items-start justify-between gap-4 p-4 border rounded-lg">
							<div className="space-y-1">
								<div className="font-medium">Use organization guardrails</div>
								<p className="text-sm text-muted-foreground">
									While this is on, the organization guardrails take precedence
									and the settings below are read-only. Turn it off to give this
									project its own guardrails, which then replace the
									organization&apos;s.
								</p>
							</div>
							<Switch
								checked={draft.inheritOrganization}
								onCheckedChange={(inheritOrganization) =>
									setDraft({ ...draft, inheritOrganization })
								}
							/>
						</div>
					</CardContent>
				)}
			</Card>

			{isProject && (
				<Alert>
					<Building2 />
					<AlertTitle>
						{inherits
							? "Organization settings apply to this project"
							: "This project overrides the organization settings"}
					</AlertTitle>
					<AlertDescription>
						{inherits ? (
							<span>
								Requests from this project are checked against the{" "}
								<Link
									href={`/dashboard/${scope.organizationId}/org/guardrails`}
									className="underline underline-offset-4"
								>
									organization guardrails
								</Link>
								. Changes made there apply here too.
							</span>
						) : (
							<span>
								The{" "}
								<Link
									href={`/dashboard/${scope.organizationId}/org/guardrails`}
									className="underline underline-offset-4"
								>
									organization guardrails
								</Link>{" "}
								do not apply to this project — only the settings and custom
								rules below are enforced.
							</span>
						)}
					</AlertDescription>
				</Alert>
			)}

			{!isProject && overrides.length > 0 && (
				<Alert>
					<Building2 />
					<AlertTitle>
						{overrides.length === 1
							? "1 project overrides these settings"
							: `${overrides.length} projects override these settings`}
					</AlertTitle>
					<AlertDescription>
						<span>
							These settings do not apply to{" "}
							{overrides.map((project, index) => (
								<span key={project.id}>
									{index > 0 && ", "}
									<Link
										href={`/dashboard/${scope.organizationId}/${project.id}/settings/guardrails`}
										className="underline underline-offset-4"
									>
										{project.name}
									</Link>
								</span>
							))}
							, which enforce their own guardrails.
						</span>
					</AlertDescription>
				</Alert>
			)}

			<div
				className={
					shown.enabled ? "" : "opacity-60 pointer-events-none select-none"
				}
			>
				<Card className="mb-6">
					<CardHeader>
						<CardTitle>System Rules</CardTitle>
						<CardDescription>
							Built-in security rules powered by pattern matching
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{SYSTEM_RULES.map((rule) => {
							const ruleConfig = shown.systemRules[rule.id];
							return (
								<div
									key={rule.id}
									className="flex items-center justify-between p-4 border rounded-lg"
								>
									<div className="flex items-center gap-4">
										<Switch
											checked={ruleConfig?.enabled ?? false}
											disabled={!editable}
											onCheckedChange={(enabled) =>
												updateSystemRule(rule.id, "enabled", enabled)
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
											disabled={!editable}
											onValueChange={(value) =>
												updateSystemRule(rule.id, "action", value)
											}
										>
											<SelectTrigger className="w-32">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="block">Block</SelectItem>
												{(rule.id === "pii_detection" ||
													rule.id === "secrets") && (
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
								value={shown.maxFileSizeMb}
								disabled={!editable}
								onChange={(e) =>
									setDraft({
										...draft,
										maxFileSizeMb: parseInt(e.target.value, 10) || 10,
									})
								}
								className="w-32"
							/>
						</div>
						<div className="space-y-2">
							<Label>Allowed File Types</Label>
							<div className="flex flex-wrap gap-2">
								{shown.allowedFileTypes.map((type) => (
									<Badge key={type} variant="secondary">
										{type}
										{editable && (
											<button
												onClick={() =>
													setDraft({
														...draft,
														allowedFileTypes: draft.allowedFileTypes.filter(
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
									disabled={!editable}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											const input = e.currentTarget;
											const value = input.value.trim().toLowerCase();
											if (value && !draft.allowedFileTypes.includes(value)) {
												setDraft({
													...draft,
													allowedFileTypes: [...draft.allowedFileTypes, value],
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
								disabled={!editable}
							>
								<Plus className="h-4 w-4 mr-2" />
								Add Rule
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{showAddRule && editable && (
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
											onValueChange={(value) => {
												const type = value as CustomRuleType;
												setNewRule({
													...newRule,
													type,
													action:
														type === "topic_restriction" &&
														newRule.action === "redact"
															? "block"
															: newRule.action,
												});
											}}
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
												action: value as GuardrailAction,
											})
										}
									>
										<SelectTrigger className="w-48">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="block">Block</SelectItem>
											{(newRule.type === "blocked_terms" ||
												newRule.type === "custom_regex") && (
												<SelectItem value="redact">Redact</SelectItem>
											)}
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

						{shownRules.length === 0 && !showAddRule && (
							<div className="text-center py-8 text-muted-foreground">
								No custom rules configured.
								{readOnly
									? " Rules are managed at organization level."
									: shown.enabled
										? ' Click "Add Rule" to create one.'
										: " Enable guardrails to add rules."}
							</div>
						)}

						{shownRules.map((rule) => (
							<div
								key={rule.id}
								className="flex items-center justify-between p-4 border rounded-lg"
							>
								<div className="flex items-center gap-4">
									<Switch
										checked={rule.enabled}
										disabled={!editable}
										onCheckedChange={() =>
											updateRuleMutation.mutate({
												ruleId: rule.id,
												enabled: !rule.enabled,
											})
										}
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
										disabled={!editable}
										onClick={() => deleteRuleMutation.mutate(rule.id)}
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
		</div>
	);
}
