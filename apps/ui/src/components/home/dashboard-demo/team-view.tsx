"use client";

import { addDays, subMinutes } from "date-fns";
import {
	BarChart3Icon,
	Info,
	KeyRound,
	Layers3,
	MoreHorizontal,
	Plus,
	Users,
} from "lucide-react";
import { useState } from "react";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import {
	DEFAULT_DEVELOPER_BUDGET,
	DEMO_API_KEYS,
	DEMO_MEMBERS,
	DEMO_TEAMS,
	SEAT_LIMIT,
	sliceHistory,
	type DemoBudget,
} from "@/components/home/dashboard-demo-data";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/lib/components/hover-card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";
import { applyUsageMode, type UsageMode } from "@/lib/usage-mode";
import { cn } from "@/lib/utils";

import { formatNumber } from "@llmgateway/shared/number-format";

import { READ_ONLY_MESSAGE, useDemo } from "./context";
import {
	DateRangeControl,
	UsageModeControl,
	defaultDateRange,
} from "./controls";

import type { UsageDateRange } from "@/components/dashboard/usage-comparison";

const ROLE_PERMISSIONS = [
	{
		role: "Owner",
		description:
			"Full access to all features including team management, billing, and organization settings.",
	},
	{
		role: "Admin",
		description:
			"Can manage team members, projects, and API keys, but cannot access billing settings or modify owners.",
	},
	{
		role: "Project admin",
		description:
			"Manages assigned project settings, routing, guardrails, API keys, and project-wide usage. No organization administration.",
	},
	{
		role: "Developer",
		description:
			"Can manage their own API keys and see their own usage in assigned projects. Cannot change project settings.",
	},
	{
		role: "Restricted Access",
		description:
			"If you want a user to just access the API but not the dashboard or settings, just add an API key for them, where you can also set specific permissions. Use “Manage budget” to cap a member's active API keys and their total or per-period spend.",
	},
] as const;

const PENDING_INVITE = {
	email: "noah@acme.com",
	role: "developer",
	projects: ["Production API"],
	invitedMinutesAgo: 22,
};

function budgetBadges(budget: DemoBudget | null): string[] {
	const badges: string[] = [];
	if (!budget) {
		return badges;
	}
	if (budget.usageLimit !== null) {
		badges.push(`${currencyFormatter.format(budget.usageLimit)} total`);
	}
	if (
		budget.periodUsageLimit !== null &&
		budget.periodUsageDurationValue !== null &&
		budget.periodUsageDurationUnit !== null
	) {
		const value = budget.periodUsageDurationValue;
		const unit = budget.periodUsageDurationUnit;
		const period = value === 1 ? unit : `${value} ${unit}s`;
		badges.push(
			`${currencyFormatter.format(budget.periodUsageLimit)}/${period}`,
		);
	}
	if (budget.maxApiKeys !== null) {
		badges.push(
			`${budget.maxApiKeys} ${budget.maxApiKeys === 1 ? "key" : "keys"}`,
		);
	}
	return badges;
}

function RolePermissionsHoverCard() {
	return (
		<HoverCard openDelay={100} closeDelay={100}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center align-middle text-muted-foreground transition-colors hover:text-foreground"
					aria-label="Role permissions"
				>
					<Info className="h-3.5 w-3.5" />
				</button>
			</HoverCardTrigger>
			<HoverCardContent align="start" className="w-80 space-y-3">
				<p className="text-sm font-semibold">Role permissions</p>
				{ROLE_PERMISSIONS.map((item) => (
					<div key={item.role}>
						<h4 className="text-sm font-medium">{item.role}</h4>
						<p className="text-xs text-muted-foreground">{item.description}</p>
					</div>
				))}
			</HoverCardContent>
		</HoverCard>
	);
}

function TeamTabs({
	active,
	onChange,
}: {
	active: "members" | "teams";
	onChange: (tab: "members" | "teams") => void;
}) {
	return (
		<nav
			className="inline-flex w-fit gap-1 rounded-lg bg-muted/50 p-1"
			aria-label="Team sections"
		>
			<Button
				variant="ghost"
				size="sm"
				className={cn(active === "members" && "bg-background shadow-sm")}
				aria-current={active === "members" ? "page" : undefined}
				onClick={() => onChange("members")}
			>
				<Users className="mr-2 h-4 w-4" />
				Members
			</Button>
			<Button
				variant="ghost"
				size="sm"
				className={cn(active === "teams" && "bg-background shadow-sm")}
				aria-current={active === "teams" ? "page" : undefined}
				onClick={() => onChange("teams")}
			>
				<Layers3 className="mr-2 h-4 w-4" />
				Teams
			</Button>
		</nav>
	);
}

function TeamsTab({
	onTabChange,
}: {
	onTabChange: (tab: "members" | "teams") => void;
}) {
	const { notify } = useDemo();
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-6 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Team</h2>
						<p className="text-muted-foreground">
							Group developers under shared project, IAM, and budget ceilings.
						</p>
					</div>
					<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
						<Plus className="mr-2 h-4 w-4" />
						Create team
					</Button>
				</div>

				<TeamTabs active="teams" onChange={onTabChange} />

				<Card>
					<CardHeader>
						<CardTitle>Organization teams</CardTitle>
						<CardDescription>
							A developer can belong to one team. Team policy is enforced before
							personal and API-key restrictions.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Name</TableHead>
									<TableHead>Members</TableHead>
									<TableHead>Projects</TableHead>
									<TableHead>IAM</TableHead>
									<TableHead className="text-right">Manage</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{DEMO_TEAMS.map((team) => (
									<TableRow key={team.id}>
										<TableCell className="font-medium">{team.name}</TableCell>
										<TableCell>{team.members}</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1">
												{team.projects.map((project) => (
													<Badge key={project} variant="outline">
														{project}
													</Badge>
												))}
											</div>
										</TableCell>
										<TableCell>{team.iamRules} rules</TableCell>
										<TableCell className="text-right">
											<Button
												variant="outline"
												size="sm"
												onClick={() => notify(READ_ONLY_MESSAGE)}
											>
												Open
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}

export function TeamView() {
	const { anchorDay, history, openedAt, navigate, notify, track } = useDemo();
	const [tab, setTab] = useState<"members" | "teams">("members");
	const [usageMode, setUsageMode] = useState<UsageMode>("total");
	const [pickedRange, setPickedRange] = useState<UsageDateRange | null>(null);
	const range = pickedRange ?? defaultDateRange(anchorDay);

	const changeTab = (next: "members" | "teams") => {
		setTab(next);
		track("team_tab", next);
	};

	if (tab === "teams") {
		return <TeamsTab onTabChange={changeTab} />;
	}

	const usageByUser = new Map<
		string,
		{ cost: number; totalTokens: number; requestCount: number }
	>();
	for (const day of sliceHistory(history, range.from, range.to)) {
		for (const user of day.userBreakdown) {
			const usage = applyUsageMode(user, usageMode);
			const current = usageByUser.get(user.id) ?? {
				cost: 0,
				totalTokens: 0,
				requestCount: 0,
			};
			usageByUser.set(user.id, {
				cost: current.cost + usage.cost,
				totalTokens: current.totalTokens + usage.totalTokens,
				requestCount: current.requestCount + usage.requestCount,
			});
		}
	}
	const seatsUsed = DEMO_MEMBERS.length + 1;
	const invitedAt = subMinutes(openedAt, PENDING_INVITE.invitedMinutesAgo);
	const dateFormat = new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="space-y-4">
					<div className="flex flex-col gap-4">
						<div>
							<h2 className="text-3xl font-bold tracking-tight">Team</h2>
							<p className="text-muted-foreground">
								Manage your organization's members and their roles, and track
								usage per member.
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<UsageModeControl
								mode={usageMode}
								onChange={(mode) => {
									setUsageMode(mode);
									track("usage_mode", mode);
								}}
							/>
							<DateRangeControl
								anchorDay={anchorDay}
								range={range}
								onChange={(next, label) => {
									setPickedRange(next);
									track("date_range", label);
								}}
							/>
							<Button onClick={() => notify(READ_ONLY_MESSAGE)}>
								Add Member
							</Button>
						</div>
					</div>

					<TeamTabs active="members" onChange={changeTab} />

					<div className="relative overflow-hidden rounded-lg border bg-gradient-to-br from-primary/5 via-card to-card p-4 sm:p-5">
						<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
							<div className="flex items-start gap-3">
								<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background">
									<KeyRound className="h-5 w-5 text-primary" />
								</div>
								<div className="space-y-1">
									<h3 className="text-sm font-semibold">
										Prefer to track usage by API key?
									</h3>
									<p className="max-w-xl text-sm text-muted-foreground">
										Every API key has the same breakdown you see here — cost,
										tokens, requests, and a model-by-model view over time. Handy
										when your usage runs through services, not just people.
									</p>
								</div>
							</div>
							<Button
								variant="outline"
								className="shrink-0"
								onClick={() => navigate("api-keys")}
							>
								<BarChart3Icon className="mr-2 h-4 w-4" />
								View API key analytics
							</Button>
						</div>
					</div>

					<Card>
						<CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
							<div className="space-y-1">
								<CardTitle className="text-base">
									Default developer limits
								</CardTitle>
								<CardDescription>
									Applied to every developer. A developer's own limits override
									these.
								</CardDescription>
							</div>
							<Button
								variant="outline"
								size="sm"
								onClick={() => notify(READ_ONLY_MESSAGE)}
							>
								Edit defaults
							</Button>
						</CardHeader>
						<CardContent>
							<div className="flex flex-wrap gap-1.5">
								{budgetBadges(DEFAULT_DEVELOPER_BUDGET).map((badge) => (
									<Badge
										key={badge}
										variant="secondary"
										className="font-normal"
									>
										{badge}
									</Badge>
								))}
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Team Members</CardTitle>
							<CardDescription>
								Manage your organization's team members and their roles (
								{seatsUsed}/{SEAT_LIMIT} seats used, including 1 pending
								invitation). Cost is attributed to the member who created each
								API key.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Name</TableHead>
										<TableHead>Email</TableHead>
										<TableHead>
											<span className="inline-flex items-center gap-1.5">
												Role
												<RolePermissionsHoverCard />
											</span>
										</TableHead>
										<TableHead>Team</TableHead>
										<TableHead>Projects</TableHead>
										<TableHead>Limits</TableHead>
										<TableHead className="text-right">Cost</TableHead>
										<TableHead className="text-right">Tokens</TableHead>
										<TableHead className="text-right">Requests</TableHead>
										<TableHead className="text-right">API keys</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{DEMO_MEMBERS.map((member) => {
										const usage = usageByUser.get(member.userId);
										const memberBadges = budgetBadges(member.budget);
										const teamBadges = budgetBadges(member.teamBudget);
										return (
											<TableRow key={member.id}>
												<TableCell>
													<button
														type="button"
														onClick={() => notify(READ_ONLY_MESSAGE)}
														className="font-medium hover:underline"
													>
														{member.name}
													</button>
												</TableCell>
												<TableCell>{member.email}</TableCell>
												<TableCell>
													<Badge variant="secondary" className="capitalize">
														{member.role.replace("_", " ")}
													</Badge>
												</TableCell>
												<TableCell>
													{member.team ? (
														<Badge variant="outline">{member.team}</Badge>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell>
													{member.projects === null ? (
														<span className="text-sm text-muted-foreground">
															All projects
														</span>
													) : (
														<div className="flex flex-wrap gap-1">
															{member.projects.map((project) => (
																<Badge
																	key={project}
																	variant="outline"
																	className="font-normal"
																>
																	{project}
																</Badge>
															))}
														</div>
													)}
												</TableCell>
												<TableCell>
													{memberBadges.length || teamBadges.length ? (
														<div className="space-y-1.5">
															{teamBadges.length > 0 && (
																<div className="flex flex-wrap items-center gap-1">
																	<span className="text-xs text-muted-foreground">
																		Team
																	</span>
																	{teamBadges.map((badge) => (
																		<Badge
																			key={badge}
																			variant="outline"
																			className="font-normal"
																		>
																			{badge}
																		</Badge>
																	))}
																</div>
															)}
															{memberBadges.length > 0 && (
																<div className="flex flex-wrap items-center gap-1">
																	<span className="text-xs text-muted-foreground">
																		Personal/default
																	</span>
																	{memberBadges.map((badge) => (
																		<Badge
																			key={badge}
																			variant="secondary"
																			className="font-normal"
																		>
																			{badge}
																		</Badge>
																	))}
																</div>
															)}
														</div>
													) : (
														<span className="text-muted-foreground">—</span>
													)}
												</TableCell>
												<TableCell className="text-right font-medium">
													{currencyFormatter.format(usage?.cost ?? 0)}
												</TableCell>
												<TableCell className="text-right">
													{formatNumber(usage?.totalTokens ?? 0)}
												</TableCell>
												<TableCell className="text-right">
													{formatNumber(usage?.requestCount ?? 0)}
												</TableCell>
												<TableCell className="text-right">
													{
														DEMO_API_KEYS.filter(
															(key) => key.ownerId === member.userId,
														).length
													}
												</TableCell>
												<TableCell className="text-right">
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="icon"
																className="h-8 w-8"
															>
																<MoreHorizontal className="h-4 w-4" />
																<span className="sr-only">Open menu</span>
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuLabel>Actions</DropdownMenuLabel>
															{[
																"Details",
																"Manage access",
																"Manage budget",
																"Manage IAM rules",
															].map((action) => (
																<DropdownMenuItem
																	key={action}
																	onSelect={() => notify(READ_ONLY_MESSAGE)}
																>
																	{action}
																</DropdownMenuItem>
															))}
															<DropdownMenuSeparator />
															<DropdownMenuItem
																className="text-destructive focus:text-destructive"
																onSelect={() => notify(READ_ONLY_MESSAGE)}
															>
																Remove
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Pending Invitations</CardTitle>
							<CardDescription>
								People invited by email who haven't joined yet. They'll join
								after signing in or signing up with their invited email,
								including via SSO or SCIM provisioning.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Email</TableHead>
										<TableHead>Role</TableHead>
										<TableHead>Projects</TableHead>
										<TableHead>Invited</TableHead>
										<TableHead>Expires</TableHead>
										<TableHead className="text-right">Actions</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									<TableRow>
										<TableCell>{PENDING_INVITE.email}</TableCell>
										<TableCell>
											<Badge variant="secondary" className="capitalize">
												{PENDING_INVITE.role}
											</Badge>
										</TableCell>
										<TableCell>
											<div className="flex flex-wrap gap-1">
												{PENDING_INVITE.projects.map((project) => (
													<Badge
														key={project}
														variant="outline"
														className="font-normal"
													>
														{project}
													</Badge>
												))}
											</div>
										</TableCell>
										<TableCell>{dateFormat.format(invitedAt)}</TableCell>
										<TableCell>
											{dateFormat.format(addDays(invitedAt, 30))}
										</TableCell>
										<TableCell className="text-right">
											<Button
												variant="ghost"
												size="sm"
												className="text-destructive hover:text-destructive"
												onClick={() => notify(READ_ONLY_MESSAGE)}
											>
												Revoke
											</Button>
										</TableCell>
									</TableRow>
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				</div>
			</div>
		</div>
	);
}
