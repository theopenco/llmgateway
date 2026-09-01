import { FolderOpen, Layers3, Shield, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import { SendEmailDialog } from "./send-email-dialog";

import type { paths } from "@/lib/api/v1";

type MemberAccessData =
	paths["/admin/organizations/{orgId}/members"]["get"]["responses"]["200"]["content"]["application/json"];
type IamRule = MemberAccessData["members"][number]["iamRules"][number];
type Team = MemberAccessData["teams"][number];

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

function formatRuleType(type: IamRule["ruleType"]) {
	return type
		.replaceAll("_", " ")
		.replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRuleValue(rule: IamRule) {
	const value = rule.ruleValue;
	if (value.models?.length) {
		return value.models.join(", ");
	}
	if (value.providers?.length) {
		return value.providers.join(", ");
	}
	if (value.ipCidrs?.length) {
		return value.ipCidrs.join(", ");
	}
	if (
		value.pricingType ||
		typeof value.maxInputPrice === "number" ||
		typeof value.maxOutputPrice === "number"
	) {
		const constraints: string[] = [];
		if (value.pricingType) {
			constraints.push(value.pricingType);
		}
		if (typeof value.maxInputPrice === "number") {
			constraints.push(`input ≤ $${value.maxInputPrice}/M`);
		}
		if (typeof value.maxOutputPrice === "number") {
			constraints.push(`output ≤ $${value.maxOutputPrice}/M`);
		}
		return constraints.join(" · ");
	}
	return "No constraints";
}

function IamRules({
	rules,
	emptyLabel,
}: {
	rules: IamRule[];
	emptyLabel: string;
}) {
	if (rules.length === 0) {
		return <span className="text-sm text-muted-foreground">{emptyLabel}</span>;
	}

	return (
		<ul className="space-y-2">
			{rules.map((rule) => (
				<li key={rule.id} className="min-w-0 text-sm">
					<div className="flex flex-wrap items-center gap-1.5">
						<Badge
							variant={
								rule.ruleType.startsWith("deny_") ? "destructive" : "secondary"
							}
						>
							{formatRuleType(rule.ruleType)}
						</Badge>
						{rule.status === "inactive" ? (
							<Badge variant="outline">Inactive</Badge>
						) : null}
					</div>
					<p className="mt-1 break-words text-xs leading-5 text-muted-foreground">
						{formatRuleValue(rule)}
					</p>
				</li>
			))}
		</ul>
	);
}

function roleBadgeVariant(role: string) {
	if (role === "owner") {
		return "default" as const;
	}
	if (role === "admin") {
		return "secondary" as const;
	}
	return "outline" as const;
}

function teamLimits(team: Team) {
	const limits: string[] = [];
	if (team.budget.maxApiKeys !== null) {
		limits.push(`${team.budget.maxApiKeys} API keys`);
	}
	if (team.budget.usageLimit !== null) {
		limits.push(
			`${creditsFormatter.format(Number(team.budget.usageLimit))} lifetime spend`,
		);
	}
	if (
		team.budget.periodUsageLimit !== null &&
		team.budget.periodUsageDurationValue !== null &&
		team.budget.periodUsageDurationUnit !== null
	) {
		const duration = team.budget.periodUsageDurationValue;
		const unit = team.budget.periodUsageDurationUnit;
		limits.push(
			`${creditsFormatter.format(Number(team.budget.periodUsageLimit))} every ${duration} ${unit}${duration === 1 ? "" : "s"}`,
		);
	}
	return limits;
}

export function MemberAccessTab({
	data,
	organizationName,
	plan,
}: {
	data: MemberAccessData;
	organizationName: string;
	plan: string;
}) {
	return (
		<div className="space-y-8">
			<section className="space-y-3" aria-labelledby="organization-members">
				<div>
					<div className="flex items-center gap-2">
						<Users className="h-5 w-5 text-muted-foreground" />
						<h2 id="organization-members" className="text-lg font-semibold">
							Members
						</h2>
						<span className="text-sm text-muted-foreground">
							({data.total})
						</span>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Organization roles, team assignments, and member-specific IAM
						restrictions.
					</p>
				</div>

				<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Email</TableHead>
								<TableHead>Verified</TableHead>
								<TableHead>Organization role</TableHead>
								<TableHead>Team</TableHead>
								<TableHead className="min-w-64">Direct IAM rules</TableHead>
								<TableHead>Joined</TableHead>
								<TableHead className="w-10">
									<span className="sr-only">Actions</span>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{data.members.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={8}
										className="h-24 text-center text-muted-foreground"
									>
										No members found
									</TableCell>
								</TableRow>
							) : (
								data.members.map((member) => (
									<TableRow key={member.id}>
										<TableCell className="font-medium">
											{member.user.name ?? "—"}
										</TableCell>
										<TableCell>{member.user.email}</TableCell>
										<TableCell>
											<Badge
												variant={
													member.user.emailVerified ? "secondary" : "outline"
												}
											>
												{member.user.emailVerified ? "Verified" : "Unverified"}
											</Badge>
										</TableCell>
										<TableCell>
											<Badge variant={roleBadgeVariant(member.role)}>
												{member.role}
											</Badge>
										</TableCell>
										<TableCell>
											{member.team ? (
												<div className="space-y-1">
													<div className="flex flex-wrap items-center gap-1.5">
														<Badge variant="outline">{member.team.name}</Badge>
														{member.team.isDefault ? (
															<Badge variant="secondary">Default</Badge>
														) : null}
													</div>
													<p className="text-xs text-muted-foreground">
														Assigned via {member.teamAssignmentSource}
													</p>
												</div>
											) : (
												<span className="text-sm text-muted-foreground">
													Unassigned
												</span>
											)}
										</TableCell>
										<TableCell>
											<IamRules
												rules={member.iamRules}
												emptyLabel="No direct rules"
											/>
										</TableCell>
										<TableCell className="text-muted-foreground">
											{formatDate(member.createdAt)}
										</TableCell>
										<TableCell>
											<SendEmailDialog
												userName={member.user.name ?? ""}
												userEmail={member.user.email}
												orgName={organizationName}
												plan={plan}
											/>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</section>

			<section className="space-y-3" aria-labelledby="organization-teams">
				<div>
					<div className="flex items-center gap-2">
						<Layers3 className="h-5 w-5 text-muted-foreground" />
						<h2 id="organization-teams" className="text-lg font-semibold">
							Teams
						</h2>
						<span className="text-sm text-muted-foreground">
							({data.teamTotal})
						</span>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Assigned members, project access, budget ceilings, and shared IAM
						rules.
					</p>
				</div>

				{data.teams.length === 0 ? (
					<div className="flex min-h-36 flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 text-center">
						<Layers3 className="mb-3 h-6 w-6 text-muted-foreground" />
						<p className="font-medium">No organization teams configured</p>
						<p className="mt-1 text-sm text-muted-foreground">
							Members only use their direct IAM and API-key rules.
						</p>
					</div>
				) : (
					<div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card">
						{data.teams.map((team) => {
							const limits = teamLimits(team);
							return (
								<article key={team.id} className="p-4 md:p-5">
									<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
										<div>
											<div className="flex flex-wrap items-center gap-2">
												<h3 className="font-semibold">{team.name}</h3>
												{team.isDefault ? (
													<Badge variant="secondary">Default</Badge>
												) : null}
											</div>
											<p className="mt-1 text-xs text-muted-foreground">
												Updated {formatDate(team.updatedAt)}
											</p>
										</div>
										<div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
											<span>{team.members.length} members</span>
											<span aria-hidden="true">·</span>
											<span>{team.projects.length} projects</span>
											<span aria-hidden="true">·</span>
											<span>{team.iamRules.length} IAM rules</span>
										</div>
									</div>

									<div className="mt-5 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
										<div>
											<h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
												<Users className="h-4 w-4 text-muted-foreground" />
												Members
											</h4>
											{team.members.length === 0 ? (
												<p className="text-sm text-muted-foreground">
													No assigned members
												</p>
											) : (
												<ul className="space-y-1.5 text-sm">
													{team.members.map((member) => (
														<li key={member.id} className="min-w-0">
															<p className="truncate font-medium">
																{member.name ?? "—"}
															</p>
															<p className="truncate text-xs text-muted-foreground">
																{member.email}
															</p>
														</li>
													))}
												</ul>
											)}
										</div>

										<div>
											<h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
												<FolderOpen className="h-4 w-4 text-muted-foreground" />
												Project access
											</h4>
											{team.projects.length === 0 ? (
												<Badge variant="destructive">No access</Badge>
											) : (
												<div className="flex flex-wrap gap-1.5">
													{team.projects.map((project) => (
														<Badge key={project.id} variant="outline">
															{project.name}
														</Badge>
													))}
												</div>
											)}
										</div>

										<div>
											<h4 className="mb-2 text-sm font-medium">Limits</h4>
											{limits.length === 0 ? (
												<p className="text-sm text-muted-foreground">
													No team limits
												</p>
											) : (
												<ul className="space-y-1.5 text-sm">
													{limits.map((limit) => (
														<li key={limit}>{limit}</li>
													))}
												</ul>
											)}
										</div>

										<div>
											<h4 className="mb-2 flex items-center gap-1.5 text-sm font-medium">
												<Shield className="h-4 w-4 text-muted-foreground" />
												Team IAM rules
											</h4>
											<IamRules
												rules={team.iamRules}
												emptyLabel="No shared rules"
											/>
										</div>
									</div>
								</article>
							);
						})}
					</div>
				)}
			</section>
		</div>
	);
}
