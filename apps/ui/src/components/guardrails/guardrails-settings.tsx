"use client";

import { Building2, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
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
import { Checkbox } from "@/lib/components/checkbox";
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
import { Textarea } from "@/lib/components/textarea";
import { useApi } from "@/lib/fetch-client";

import {
	canManageProject,
	isOrganizationAdmin,
} from "@llmgateway/shared/organization-roles";

import type {
	GuardrailConfig,
	GuardrailRule,
	GuardrailsScope,
} from "@/hooks/useGuardrails";

type SystemRulesConfig = NonNullable<GuardrailConfig["systemRules"]>;
type SystemRuleKey = keyof SystemRulesConfig;
type SystemRuleConfig = SystemRulesConfig["prompt_injection"];
type GuardrailAction = SystemRuleConfig["action"];
type PiiEntity = NonNullable<SystemRuleConfig["entities"]>[number];
type CustomRuleType = GuardrailRule["type"];
type CustomRuleConfig = GuardrailRule["config"];

const SYSTEM_RULES: {
	id: SystemRuleKey;
	name: string;
	description: string;
	redactable: boolean;
	/** "optional" offers the ML classifier on top of patterns. */
	classifier: "none" | "optional" | "always";
}[] = [
	{
		id: "prompt_injection",
		name: "Prompt Injection Detection",
		description:
			"Detect attempts to override or extract instructions. System prompts are not scanned.",
		redactable: false,
		classifier: "optional",
	},
	{
		id: "jailbreak",
		name: "Jailbreak Prevention",
		description:
			"Detect attempts to bypass AI safety measures. System prompts are not scanned.",
		redactable: false,
		classifier: "optional",
	},
	{
		id: "pii_detection",
		name: "PII Detection",
		description: "Detect and optionally redact personal data",
		redactable: true,
		classifier: "none",
	},
	{
		id: "secrets",
		name: "Secrets Detection",
		description: "Detect API keys, tokens, private keys and passwords",
		redactable: true,
		classifier: "none",
	},
	{
		id: "file_types",
		name: "File Restrictions",
		description: "Enforce the allowed file types and size below",
		redactable: false,
		classifier: "none",
	},
	{
		id: "document_leakage",
		name: "Document Leakage Prevention",
		description: "Flag confidentiality markers such as “internal use only”",
		redactable: false,
		classifier: "none",
	},
	{
		id: "harmful_content",
		name: "Harmful Content",
		description:
			"Score harassment, hate, violence, self-harm, sexual and illicit content with the ML classifier",
		redactable: false,
		classifier: "always",
	},
];

const PII_ENTITIES: { id: PiiEntity; label: string }[] = [
	{ id: "email", label: "Email" },
	{ id: "phone", label: "Phone" },
	{ id: "credit_card", label: "Credit card" },
	{ id: "iban", label: "IBAN" },
	{ id: "ssn", label: "SSN" },
	{ id: "ip_address", label: "IP address" },
	{ id: "passport", label: "Passport" },
	{ id: "drivers_license", label: "Driver's license" },
];

const REDACTABLE_RULE_TYPES: CustomRuleType[] = [
	"blocked_terms",
	"custom_regex",
	"sensitive_data",
];

const RULE_TYPE_LABELS: Record<CustomRuleType, string> = {
	blocked_terms: "Blocked terms",
	custom_regex: "Custom regex",
	topic_restriction: "Topic restriction",
	sensitive_data: "Sensitive data",
	classifier: "ML classifier",
};

const DEFAULT_SYSTEM_RULES: SystemRulesConfig = {
	prompt_injection: { enabled: true, action: "block", classifier: false },
	jailbreak: { enabled: true, action: "block", classifier: false },
	pii_detection: { enabled: true, action: "redact" },
	secrets: { enabled: true, action: "block" },
	file_types: { enabled: true, action: "block" },
	document_leakage: { enabled: false, action: "warn" },
	harmful_content: { enabled: false, action: "block", classifier: true },
};

const DEFAULT_ALLOWED_FILE_TYPES = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
];

interface NewRuleDraft {
	name: string;
	type: CustomRuleType;
	action: GuardrailAction;
	terms: string;
	pattern: string;
	topics: string;
	allowedTopics: string;
	topicClassifier: boolean;
	entities: PiiEntity[];
	instructions: string;
}

const EMPTY_RULE: NewRuleDraft = {
	name: "",
	type: "blocked_terms",
	action: "block",
	terms: "",
	pattern: "",
	topics: "",
	allowedTopics: "",
	topicClassifier: false,
	entities: [],
	instructions: "",
};

/** Starting points for common company policies. */
const RULE_TEMPLATES: { label: string; rule: Partial<NewRuleDraft> }[] = [
	{
		label: "Block email addresses",
		rule: {
			name: "Block email addresses",
			type: "sensitive_data",
			entities: ["email"],
			action: "block",
		},
	},
	{
		label: "Redact payment data",
		rule: {
			name: "Redact payment data",
			type: "sensitive_data",
			entities: ["credit_card", "iban"],
			action: "redact",
		},
	},
	{
		label: "Block competitor mentions",
		rule: {
			name: "Block competitor mentions",
			type: "blocked_terms",
			terms: "",
			action: "block",
		},
	},
	{
		label: "No legal advice",
		rule: {
			name: "No legal advice",
			type: "classifier",
			instructions:
				"The text asks for legal advice about the user's own situation.",
			action: "block",
		},
	},
	{
		label: "Stay on topic",
		rule: {
			name: "Stay on topic",
			type: "topic_restriction",
			topicClassifier: true,
			allowedTopics: "our product\nbilling\naccount support",
			action: "block",
		},
	},
];

const splitLines = (value: string) =>
	value
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

function buildRuleConfig(rule: NewRuleDraft): CustomRuleConfig {
	switch (rule.type) {
		case "blocked_terms":
			return {
				type: "blocked_terms",
				terms: splitLines(rule.terms),
				matchType: "contains",
				caseSensitive: false,
			};
		case "custom_regex":
			return { type: "custom_regex", pattern: rule.pattern };
		case "sensitive_data":
			return { type: "sensitive_data", entities: rule.entities };
		case "classifier":
			return { type: "classifier", instructions: rule.instructions.trim() };
		case "topic_restriction":
			return {
				type: "topic_restriction",
				blockedTopics: splitLines(rule.topics),
				classifier: rule.topicClassifier,
				...(rule.topicClassifier && splitLines(rule.allowedTopics).length > 0
					? { allowedTopics: splitLines(rule.allowedTopics) }
					: {}),
			};
	}
}

function isRuleComplete(rule: NewRuleDraft): boolean {
	if (!rule.name.trim()) {
		return false;
	}
	switch (rule.type) {
		case "blocked_terms":
			return splitLines(rule.terms).length > 0;
		case "custom_regex":
			return rule.pattern.trim().length > 0;
		case "sensitive_data":
			return rule.entities.length > 0;
		case "classifier":
			return rule.instructions.trim().length > 0;
		case "topic_restriction":
			return (
				splitLines(rule.topics).length > 0 ||
				(rule.topicClassifier && splitLines(rule.allowedTopics).length > 0)
			);
	}
}

function usesClassifier(config: CustomRuleConfig): boolean {
	return (
		config.type === "classifier" ||
		(config.type === "topic_restriction" && config.classifier === true)
	);
}

function ruleSummary(config: CustomRuleConfig): string {
	switch (config.type) {
		case "blocked_terms":
			return `${config.terms.length} term${config.terms.length === 1 ? "" : "s"}`;
		case "custom_regex":
			return config.pattern;
		case "sensitive_data":
			return config.entities
				.map((id) => PII_ENTITIES.find((e) => e.id === id)?.label ?? id)
				.join(", ");
		case "classifier":
			return config.instructions;
		case "topic_restriction":
			return [
				config.blockedTopics.length > 0
					? `blocked: ${config.blockedTopics.join(", ")}`
					: null,
				config.allowedTopics?.length
					? `allowed only: ${config.allowedTopics.join(", ")}`
					: null,
			]
				.filter(Boolean)
				.join("; ");
	}
}

function EntityPicker({
	value,
	onChange,
	disabled,
}: {
	value: PiiEntity[] | undefined;
	onChange: (entities: PiiEntity[]) => void;
	disabled?: boolean;
}) {
	// Unset means every entity.
	const selected = value ?? PII_ENTITIES.map((entity) => entity.id);
	return (
		<div className="flex flex-wrap gap-x-4 gap-y-2">
			{PII_ENTITIES.map((entity) => (
				<label
					key={entity.id}
					className="flex items-center gap-2 text-sm cursor-pointer"
				>
					<Checkbox
						checked={selected.includes(entity.id)}
						disabled={disabled}
						onCheckedChange={(checked) =>
							onChange(
								checked
									? [...selected, entity.id]
									: selected.filter((id) => id !== entity.id),
							)
						}
					/>
					{entity.label}
				</label>
			))}
		</div>
	);
}

interface DraftConfig {
	inheritOrganization: boolean;
	enabled: boolean;
	systemRules: SystemRulesConfig;
	maxFileSizeMb: number;
	allowedFileTypes: string[];
}

const DEFAULT_DRAFT: DraftConfig = {
	inheritOrganization: true,
	enabled: false,
	systemRules: DEFAULT_SYSTEM_RULES,
	maxFileSizeMb: 10,
	allowedFileTypes: DEFAULT_ALLOWED_FILE_TYPES,
};

function toDraft(config: GuardrailConfig | null): DraftConfig {
	if (!config) {
		return DEFAULT_DRAFT;
	}

	return {
		inheritOrganization: config.inheritOrganization,
		enabled: config.enabled,
		systemRules: { ...DEFAULT_SYSTEM_RULES, ...config.systemRules },
		maxFileSizeMb: config.maxFileSizeMb,
		allowedFileTypes: config.allowedFileTypes,
	};
}

export function GuardrailsSettings({ scope }: { scope: GuardrailsScope }) {
	const api = useApi();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData, isLoading: isLoadingTeam } = useTeamMembers(
		scope.organizationId,
	);

	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isEnterprise = selectedOrganization?.enterpriseAccess === true;
	const canManageGuardrails =
		isEnterprise &&
		(scope.kind === "project"
			? canManageProject(currentUserRole)
			: isOrganizationAdmin(currentUserRole));

	const configQuery = useGuardrailConfig(scope, {
		enabled: canManageGuardrails,
	});
	const rulesQuery = useGuardrailRules(scope, { enabled: canManageGuardrails });

	// A project shows the organization settings it inherits, so both scopes are
	// loaded when the current scope is a project.
	const inheritedQuery = api.useQuery(
		"get",
		"/guardrails/projects/{projectId}/inherited",
		{
			params: {
				path: { projectId: scope.kind === "project" ? scope.projectId : "" },
			},
		},
		{ enabled: canManageGuardrails && scope.kind === "project" },
	);

	// Naming the project in the banners is what stops "this project" and the
	// organization page's override list from reading as contradictory.
	const projectsQuery = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{ params: { path: { id: scope.organizationId } } },
		{ enabled: canManageGuardrails && scope.kind === "project" },
	);
	const projectName =
		scope.kind === "project"
			? (projectsQuery.data?.projects?.find(
					(project) => project.id === scope.projectId,
				)?.name ?? "This project")
			: null;

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

	if (!canManageGuardrails) {
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
		configQuery.isLoading || rulesQuery.isLoading || inheritedQuery.isLoading;

	if (isLoading) {
		return (
			<div className="flex items-center justify-center py-12">
				<div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
			</div>
		);
	}

	// Every query counts, including the inherited organization rules: falling
	// back to an empty list there would show an inheriting project as having no
	// custom rules while the gateway keeps enforcing them.
	const loadError =
		configQuery.error || rulesQuery.error || inheritedQuery.error;

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
			organizationConfig={inheritedQuery.data?.config ?? null}
			organizationRules={inheritedQuery.data?.rules ?? []}
			projectName={projectName}
		/>
	);
}

function GuardrailsForm({
	scope,
	config,
	rules,
	organizationConfig,
	organizationRules,
	projectName,
}: {
	scope: GuardrailsScope;
	config: GuardrailConfig | null;
	rules: GuardrailRule[];
	organizationConfig: GuardrailConfig | null;
	organizationRules: GuardrailRule[];
	projectName: string | null;
}) {
	const { selectedOrganization } = useDashboardNavigation();
	const organizationGuardrails = isOrganizationAdmin(
		selectedOrganization?.role,
	) ? (
		<Link
			href={`/dashboard/${scope.organizationId}/org/guardrails`}
			className="underline underline-offset-4 whitespace-nowrap"
		>
			organization guardrails
		</Link>
	) : (
		"organization guardrails"
	);
	const isProject = scope.kind === "project";
	const [draft, setDraft] = useState<DraftConfig>(() => toDraft(config));
	const [success, setSuccess] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showAddRule, setShowAddRule] = useState(false);
	const [newRule, setNewRule] = useState<NewRuleDraft>(EMPTY_RULE);

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

	// Custom rules are written immediately, unlike the rest of the form, which
	// only lands on Save Changes. Until the override itself is persisted the
	// gateway still enforces the organization rules, so a rule added here would
	// look saved while doing nothing — keep those mutations disabled until then.
	const overridePending =
		isProject &&
		!draft.inheritOrganization &&
		config?.inheritOrganization !== false;
	const rulesEditable = editable && !overridePending;

	const overrides = overridesQuery.data ?? [];

	// Starting an override from the organization's current settings rather than
	// from the empty defaults — otherwise opting out would silently drop every
	// protection the project had a moment earlier.
	const toggleInherit = (inheritOrganization: boolean) => {
		const startsFresh =
			!inheritOrganization && config?.inheritOrganization !== false;

		setDraft({
			...(startsFresh ? toDraft(organizationConfig) : draft),
			inheritOrganization,
		});
	};

	const save = async () => {
		setError(null);
		setSuccess(null);
		try {
			// While inheriting, the form shows the organization config, so only the
			// inheritance flag is the user's own edit — persisting the rest would
			// write the project's hidden draft values that were never on screen.
			await saveMutation.mutateAsync(
				inherits
					? { inheritOrganization: true }
					: {
							...(isProject
								? { inheritOrganization: draft.inheritOrganization }
								: {}),
							enabled: draft.enabled,
							systemRules: draft.systemRules,
							maxFileSizeMb: draft.maxFileSizeMb,
							allowedFileTypes: draft.allowedFileTypes,
						},
			);
			setSuccess("Configuration saved successfully");
			setTimeout(() => setSuccess(null), 3000);
		} catch {
			setError("Failed to save configuration");
		}
	};

	const updateSystemRule = (
		ruleId: SystemRuleKey,
		patch: Partial<SystemRuleConfig>,
	) => {
		setDraft({
			...draft,
			systemRules: {
				...draft.systemRules,
				[ruleId]: { ...draft.systemRules[ruleId], ...patch },
			},
		});
	};

	const usesBilledClassifier =
		SYSTEM_RULES.some(
			(rule) =>
				shown.systemRules[rule.id]?.enabled &&
				(rule.classifier === "always" ||
					(rule.classifier === "optional" &&
						shown.systemRules[rule.id]?.classifier)),
		) || shownRules.some((rule) => rule.enabled && usesClassifier(rule.config));

	const addCustomRule = async () => {
		setError(null);

		try {
			await createRuleMutation.mutateAsync({
				name: newRule.name.trim(),
				type: newRule.type,
				action: newRule.action,
				config: buildRuleConfig(newRule),
				enabled: true,
				priority: rules.length + 1,
			});
			setShowAddRule(false);
			setNewRule(EMPTY_RULE);
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
									and the settings below are read-only. Turn it off to give{" "}
									{projectName} its own guardrails, which then replace the
									organization&apos;s for this project only.
								</p>
							</div>
							<Switch
								checked={draft.inheritOrganization}
								onCheckedChange={toggleInherit}
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
							? `${projectName} uses the organization guardrails`
							: overridePending
								? `${projectName} still uses the organization guardrails`
								: `${projectName} has its own guardrails`}
					</AlertTitle>
					<AlertDescription>
						{inherits ? (
							<span>
								Requests from {projectName} are checked against the{" "}
								{organizationGuardrails}, shown read-only below. Changes made
								there apply here too.
							</span>
						) : overridePending ? (
							<span>
								The {organizationGuardrails} stay in force until you click Save
								Changes. The settings below start as a copy of them — save to
								switch {projectName} over.
							</span>
						) : (
							<span>
								The {organizationGuardrails} do not apply to {projectName} —
								only the settings and custom rules below are enforced. Other
								projects are unaffected.
							</span>
						)}
					</AlertDescription>
				</Alert>
			)}

			{!isProject && overridesQuery.error && (
				<Alert variant="destructive">
					<Building2 />
					<AlertTitle>Could not check for project overrides</AlertTitle>
					<AlertDescription>
						Some projects may define their own guardrails, in which case the
						settings below do not apply to them. Reload the page to check again.
					</AlertDescription>
				</Alert>
			)}

			{!isProject && !overridesQuery.error && overrides.length > 0 && (
				<Alert>
					<Building2 />
					<AlertTitle>
						{overrides.length === 1
							? "1 project overrides these settings"
							: `${overrides.length} projects override these settings`}
					</AlertTitle>
					<AlertDescription>
						<span>
							The settings below apply to every project except{" "}
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
							, which{" "}
							{overrides.length === 1 ? "enforces its" : "enforce their"} own
							guardrails.
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
							Built-in rules. Pattern rules run in-process at no cost; rules
							marked ML also score requests with the Jev classifier.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{SYSTEM_RULES.map((rule) => {
							const ruleConfig = shown.systemRules[rule.id];
							const enabled = ruleConfig?.enabled ?? false;
							return (
								<div key={rule.id} className="p-4 border rounded-lg space-y-3">
									<div className="flex items-center justify-between gap-4">
										<div className="flex items-center gap-4">
											<Switch
												checked={enabled}
												disabled={!editable}
												onCheckedChange={(value) =>
													updateSystemRule(rule.id, { enabled: value })
												}
											/>
											<div>
												<div className="flex items-center gap-2 font-medium">
													{rule.name}
													{rule.classifier === "always" && (
														<Badge variant="outline" className="text-xs">
															<Sparkles className="h-3 w-3 mr-1" />
															ML
														</Badge>
													)}
												</div>
												<div className="text-sm text-muted-foreground">
													{rule.description}
												</div>
											</div>
										</div>
										{enabled && (
											<Select
												value={
													ruleConfig.action === "allow"
														? "warn"
														: ruleConfig.action
												}
												disabled={!editable}
												onValueChange={(value) =>
													updateSystemRule(rule.id, {
														action: value as GuardrailAction,
													})
												}
											>
												<SelectTrigger className="w-36">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="block">Block</SelectItem>
													{rule.redactable && (
														<SelectItem value="redact">Redact</SelectItem>
													)}
													<SelectItem value="warn">Warn (log only)</SelectItem>
												</SelectContent>
											</Select>
										)}
									</div>
									{enabled && rule.classifier === "optional" && (
										<label className="flex items-center gap-2 pl-14 text-sm cursor-pointer">
											<Switch
												checked={ruleConfig.classifier === true}
												disabled={!editable}
												onCheckedChange={(value) =>
													updateSystemRule(rule.id, { classifier: value })
												}
											/>
											<Sparkles className="h-3.5 w-3.5" />
											Also score with the ML classifier (catches paraphrased and
											non-English attempts)
										</label>
									)}
									{enabled && rule.id === "pii_detection" && (
										<div className="pl-14">
											<EntityPicker
												value={ruleConfig.entities}
												disabled={!editable}
												onChange={(entities) =>
													updateSystemRule(rule.id, { entities })
												}
											/>
										</div>
									)}
								</div>
							);
						})}
						{usesBilledClassifier && (
							<p className="text-sm text-muted-foreground">
								ML checks run as one extra Jev request per chat request, billed
								to your organization and listed in your activity logs. If that
								request fails, ML rules are skipped and pattern rules still
								apply.
							</p>
						)}
					</CardContent>
				</Card>

				<Card className="mb-6">
					<CardHeader>
						<CardTitle>File Restrictions</CardTitle>
						<CardDescription>
							Applies to images, audio and files attached to messages. Use MIME
							types (image/png, image/*) or extensions (pdf). Leave the list
							empty to allow every type.
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
									placeholder="Add type (e.g., application/pdf)"
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
								disabled={!rulesEditable}
							>
								<Plus className="h-4 w-4 mr-2" />
								Add Rule
							</Button>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{overridePending && (
							<div className="p-4 text-sm border rounded-lg bg-muted/50 text-muted-foreground">
								Save changes first to give {projectName} its own guardrails —
								custom rules added before then would not be enforced.
							</div>
						)}

						{showAddRule && rulesEditable && (
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
								<div className="flex flex-wrap gap-2">
									{RULE_TEMPLATES.map((template) => (
										<Button
											key={template.label}
											variant="outline"
											size="sm"
											onClick={() =>
												setNewRule({ ...EMPTY_RULE, ...template.rule })
											}
										>
											{template.label}
										</Button>
									))}
								</div>
								<div className="grid gap-4 md:grid-cols-3">
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
														!REDACTABLE_RULE_TYPES.includes(type) &&
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
												{(
													Object.keys(RULE_TYPE_LABELS) as CustomRuleType[]
												).map((type) => (
													<SelectItem key={type} value={type}>
														{RULE_TYPE_LABELS[type]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
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
											<SelectTrigger>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="block">Block</SelectItem>
												{REDACTABLE_RULE_TYPES.includes(newRule.type) && (
													<SelectItem value="redact">Redact</SelectItem>
												)}
												<SelectItem value="warn">Warn (log only)</SelectItem>
											</SelectContent>
										</Select>
									</div>
								</div>
								{newRule.type === "blocked_terms" && (
									<div className="space-y-2">
										<Label>Blocked Terms (one per line)</Label>
										<Textarea
											value={newRule.terms}
											onChange={(e) =>
												setNewRule({ ...newRule, terms: e.target.value })
											}
											className="h-24 resize-none"
											placeholder={"competitor\nsecret project\nconfidential"}
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
											placeholder={"e.g., \\bORD-\\d{8}\\b"}
										/>
									</div>
								)}
								{newRule.type === "sensitive_data" && (
									<div className="space-y-2">
										<Label>Detect</Label>
										<EntityPicker
											value={newRule.entities}
											onChange={(entities) =>
												setNewRule({ ...newRule, entities })
											}
										/>
									</div>
								)}
								{newRule.type === "classifier" && (
									<div className="space-y-2">
										<Label>What should this rule detect?</Label>
										<Textarea
											value={newRule.instructions}
											onChange={(e) =>
												setNewRule({
													...newRule,
													instructions: e.target.value,
												})
											}
											className="h-24 resize-none"
											placeholder="The text asks for legal advice about the user's own situation."
										/>
										<p className="text-sm text-muted-foreground">
											Scored by the Jev classifier on every request, billed as a
											separate decision request.
										</p>
									</div>
								)}
								{newRule.type === "topic_restriction" && (
									<div className="space-y-4">
										<label className="flex items-center gap-2 text-sm cursor-pointer">
											<Switch
												checked={newRule.topicClassifier}
												onCheckedChange={(topicClassifier) =>
													setNewRule({ ...newRule, topicClassifier })
												}
											/>
											<Sparkles className="h-3.5 w-3.5" />
											Judge topics with the ML classifier (billed) instead of
											keyword lists
										</label>
										<div className="grid gap-4 md:grid-cols-2">
											<div className="space-y-2">
												<Label>Restricted Topics (one per line)</Label>
												<Textarea
													value={newRule.topics}
													onChange={(e) =>
														setNewRule({ ...newRule, topics: e.target.value })
													}
													className="h-24 resize-none"
													placeholder={"politics\nreligion\nmedical_advice"}
												/>
											</div>
											{newRule.topicClassifier && (
												<div className="space-y-2">
													<Label>Only allow these topics (optional)</Label>
													<Textarea
														value={newRule.allowedTopics}
														onChange={(e) =>
															setNewRule({
																...newRule,
																allowedTopics: e.target.value,
															})
														}
														className="h-24 resize-none"
														placeholder={"our product\nbilling"}
													/>
												</div>
											)}
										</div>
									</div>
								)}
								<div className="flex justify-end gap-2">
									<Button
										variant="outline"
										onClick={() => setShowAddRule(false)}
									>
										Cancel
									</Button>
									<Button
										onClick={addCustomRule}
										disabled={
											!isRuleComplete(newRule) || createRuleMutation.isPending
										}
									>
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
									: overridePending
										? ""
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
										disabled={!rulesEditable}
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
												{usesClassifier(rule.config) && (
													<Sparkles className="h-3 w-3 mr-1" />
												)}
												{RULE_TYPE_LABELS[rule.type]}
											</Badge>
										</div>
										<div className="text-sm text-muted-foreground line-clamp-1">
											{rule.action === "allow" ? "warn" : rule.action} ·{" "}
											{ruleSummary(rule.config)}
										</div>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Button
										variant="ghost"
										size="sm"
										disabled={!rulesEditable}
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
