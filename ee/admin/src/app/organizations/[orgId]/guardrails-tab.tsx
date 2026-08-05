import { Badge } from "@/components/ui/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import type { paths } from "@/lib/api/v1";

type GuardrailsResponse =
	paths["/admin/organizations/{orgId}/guardrails"]["get"]["responses"]["200"]["content"]["application/json"];

type SystemRules = NonNullable<
	NonNullable<GuardrailsResponse["config"]>["systemRules"]
>;

type CustomRule = GuardrailsResponse["rules"][number];

const SYSTEM_RULE_LABELS: { key: keyof SystemRules; name: string }[] = [
	{ key: "prompt_injection", name: "Prompt injection" },
	{ key: "jailbreak", name: "Jailbreak" },
	{ key: "pii_detection", name: "PII detection" },
	{ key: "secrets", name: "Secrets" },
	{ key: "file_types", name: "File types" },
	{ key: "document_leakage", name: "Document leakage" },
];

function formatDateTime(dateString: string) {
	return new Date(dateString).toLocaleString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function actionBadgeVariant(action: string) {
	switch (action) {
		case "block":
		case "blocked":
			return "destructive" as const;
		case "redact":
		case "redacted":
			return "default" as const;
		case "warn":
		case "warned":
			return "secondary" as const;
		default:
			return "outline" as const;
	}
}

function ruleConfigSummary(rule: CustomRule): string {
	const config = rule.config;
	switch (config.type) {
		case "blocked_terms":
			return `${config.terms.length} term${config.terms.length === 1 ? "" : "s"} (${config.matchType}${config.caseSensitive ? ", case-sensitive" : ""}): ${config.terms.slice(0, 5).join(", ")}${config.terms.length > 5 ? "…" : ""}`;
		case "custom_regex":
			return config.pattern;
		case "topic_restriction":
			return `blocked topics: ${config.blockedTopics.join(", ")}${config.allowedTopics?.length ? `; allowed: ${config.allowedTopics.join(", ")}` : ""}`;
	}
}

export function GuardrailsTab({ data }: { data: GuardrailsResponse }) {
	const { config, rules, violations } = data;
	const systemRules = config?.systemRules ?? null;

	return (
		<div className="space-y-6">
			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							System Rules
							{config ? (
								<Badge variant={config.enabled ? "default" : "outline"}>
									{config.enabled
										? "Guardrails enabled"
										: "Guardrails disabled"}
								</Badge>
							) : (
								<Badge variant="outline">Not configured</Badge>
							)}
						</CardTitle>
						<CardDescription>
							Built-in content-safety rules and the action taken on a match.
						</CardDescription>
					</CardHeader>
					<CardContent>
						{systemRules ? (
							<div className="space-y-2">
								{SYSTEM_RULE_LABELS.map(({ key, name }) => {
									const rule = systemRules[key];
									return (
										<div
											key={key}
											className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2"
										>
											<span
												className={
													rule.enabled
														? "text-sm font-medium"
														: "text-sm text-muted-foreground"
												}
											>
												{name}
											</span>
											<div className="flex items-center gap-2">
												<Badge variant={actionBadgeVariant(rule.action)}>
													{rule.action}
												</Badge>
												<Badge variant={rule.enabled ? "secondary" : "outline"}>
													{rule.enabled ? "on" : "off"}
												</Badge>
											</div>
										</div>
									);
								})}
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								This organization has never configured guardrails.
							</p>
						)}
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>File Restrictions &amp; Violations</CardTitle>
						<CardDescription>
							Upload limits and guardrail activity.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{config ? (
							<>
								<div className="flex items-center justify-between border-b border-border/40 pb-2">
									<span className="text-sm text-muted-foreground">
										Max file size
									</span>
									<span className="text-sm font-medium">
										{config.maxFileSizeMb} MB
									</span>
								</div>
								<div className="space-y-1">
									<p className="text-sm text-muted-foreground">
										Allowed file types
									</p>
									<div className="flex flex-wrap gap-1.5">
										{config.allowedFileTypes.map((type) => (
											<Badge key={type} variant="outline" className="font-mono">
												{type}
											</Badge>
										))}
									</div>
								</div>
							</>
						) : (
							<p className="text-sm text-muted-foreground">
								No file restrictions configured.
							</p>
						)}
						<div className="grid grid-cols-2 gap-3 pt-2">
							<div className="rounded-lg border border-border/60 p-3">
								<p className="text-2xl font-semibold tabular-nums">
									{violations.total}
								</p>
								<p className="text-xs text-muted-foreground">
									Violations all-time
								</p>
							</div>
							<div className="rounded-lg border border-border/60 p-3">
								<p className="text-2xl font-semibold tabular-nums">
									{violations.last30Days}
								</p>
								<p className="text-xs text-muted-foreground">
									Violations last 30 days
								</p>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Custom Rules ({rules.length})</CardTitle>
					<CardDescription>
						Organization-defined rules, evaluated in priority order.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto rounded-lg border border-border/60">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Type</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>Priority</TableHead>
									<TableHead>Enabled</TableHead>
									<TableHead>Configuration</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rules.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={6}
											className="h-24 text-center text-muted-foreground"
										>
											No custom rules
										</TableCell>
									</TableRow>
								) : (
									rules.map((rule) => (
										<TableRow key={rule.id}>
											<TableCell className="font-medium">{rule.name}</TableCell>
											<TableCell>
												<Badge variant="outline">
													{rule.type.replace(/_/g, " ")}
												</Badge>
											</TableCell>
											<TableCell>
												<Badge variant={actionBadgeVariant(rule.action)}>
													{rule.action}
												</Badge>
											</TableCell>
											<TableCell className="tabular-nums">
												{rule.priority}
											</TableCell>
											<TableCell>
												<Badge variant={rule.enabled ? "secondary" : "outline"}>
													{rule.enabled ? "on" : "off"}
												</Badge>
											</TableCell>
											<TableCell className="max-w-[320px] truncate text-muted-foreground">
												{ruleConfigSummary(rule)}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Recent Violations</CardTitle>
					<CardDescription>
						The 10 most recent guardrail violations.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="overflow-x-auto rounded-lg border border-border/60">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Time</TableHead>
									<TableHead>Rule</TableHead>
									<TableHead>Category</TableHead>
									<TableHead>Action</TableHead>
									<TableHead>Model</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{violations.recent.length === 0 ? (
									<TableRow>
										<TableCell
											colSpan={5}
											className="h-24 text-center text-muted-foreground"
										>
											No violations recorded
										</TableCell>
									</TableRow>
								) : (
									violations.recent.map((violation) => (
										<TableRow key={violation.id}>
											<TableCell className="whitespace-nowrap text-muted-foreground">
												{formatDateTime(violation.createdAt)}
											</TableCell>
											<TableCell className="font-medium">
												{violation.ruleName}
											</TableCell>
											<TableCell>
												<Badge variant="outline">{violation.category}</Badge>
											</TableCell>
											<TableCell>
												<Badge
													variant={actionBadgeVariant(violation.actionTaken)}
												>
													{violation.actionTaken}
												</Badge>
											</TableCell>
											<TableCell className="text-muted-foreground">
												{violation.model ?? "—"}
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}
