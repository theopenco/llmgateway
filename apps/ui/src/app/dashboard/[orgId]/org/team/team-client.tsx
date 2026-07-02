"use client";

import { format, subDays } from "date-fns";
import { BarChart3Icon, Info, KeyRound, Mail, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { currencyFormatter } from "@/components/analytics/chart-helpers";
import { DateRangePicker } from "@/components/date-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	useTeamMembers,
	useAddTeamMember,
	useUpdateTeamMember,
	useUpdateMemberBudget,
	useRemoveTeamMember,
} from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Alert, AlertDescription } from "@/lib/components/alert";
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import {
	HoverCard,
	HoverCardContent,
	HoverCardTrigger,
} from "@/lib/components/hover-card";
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

import type { Route } from "next";

function ApiKeyAnalyticsCallout({ href }: { href: Route }) {
	return (
		<div className="from-primary/5 via-card to-card relative overflow-hidden rounded-lg border bg-gradient-to-br p-4 sm:p-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="bg-background flex h-10 w-10 shrink-0 items-center justify-center rounded-md border">
						<KeyRound className="text-primary h-5 w-5" />
					</div>
					<div className="space-y-1">
						<h3 className="text-sm font-semibold">
							Prefer to track usage by API key?
						</h3>
						<p className="text-muted-foreground max-w-xl text-sm">
							Every API key has the same breakdown you see here — cost, tokens,
							requests, and a model-by-model view over time. Handy when your
							usage runs through services, not just people.
						</p>
					</div>
				</div>
				<Button asChild variant="outline" className="shrink-0">
					<Link href={href} prefetch={true}>
						<BarChart3Icon className="mr-2 h-4 w-4" />
						View API key analytics
					</Link>
				</Button>
			</div>
		</div>
	);
}

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
		role: "Developer",
		description:
			"Can view and use projects and API keys, but cannot modify team or organization settings.",
	},
	{
		role: "Restricted Access",
		description:
			"If you want a user to just access the API but not the dashboard or settings, just add an API key for them, where you can also set specific permissions. Use “Manage budget” to cap a member's active API keys and their total or per-period spend.",
	},
] as const;

function RolePermissionsHoverCard() {
	return (
		<HoverCard openDelay={100} closeDelay={100}>
			<HoverCardTrigger asChild>
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground inline-flex items-center align-middle transition-colors"
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
						<p className="text-muted-foreground text-xs">{item.description}</p>
					</div>
				))}
			</HoverCardContent>
		</HoverCard>
	);
}

function MemberUsageUpsell() {
	return (
		<div className="from-primary/5 via-card to-card relative overflow-hidden rounded-lg border bg-gradient-to-br p-4 sm:p-5">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="bg-background flex h-10 w-10 shrink-0 items-center justify-center rounded-md border">
						<TrendingUp className="text-primary h-5 w-5" />
					</div>
					<div className="space-y-1">
						<h3 className="text-sm font-semibold">
							See usage by team member
							<span className="text-muted-foreground ml-2 text-xs font-normal">
								Enterprise
							</span>
						</h3>
						<p className="text-muted-foreground max-w-xl text-sm">
							Upgrade to Enterprise to break down cost, tokens, requests, and
							error rate per member — with a drill-down into the models,
							providers, and apps each person uses most, over any time period.
						</p>
					</div>
				</div>
				<Button asChild variant="outline" className="shrink-0">
					<a href="mailto:contact@llmgateway.io">
						<Mail className="mr-2 h-4 w-4" />
						Contact Sales
					</a>
				</Button>
			</div>
		</div>
	);
}

type TeamMember = NonNullable<
	ReturnType<typeof useTeamMembers>["data"]
>["members"][number];

const PERIOD_UNITS = ["hour", "day", "week", "month"] as const;

function budgetBadges(budget: TeamMember["budget"]): string[] {
	const badges: string[] = [];
	if (budget.usageLimit !== null) {
		badges.push(`${currencyFormatter.format(Number(budget.usageLimit))} total`);
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
			`${currencyFormatter.format(Number(budget.periodUsageLimit))}/${period}`,
		);
	}
	if (budget.maxApiKeys !== null) {
		badges.push(
			`${budget.maxApiKeys} ${budget.maxApiKeys === 1 ? "key" : "keys"}`,
		);
	}
	return badges;
}

function ManageBudgetDialog({
	organizationId,
	member,
	onClose,
}: {
	organizationId: string;
	member: TeamMember;
	onClose: () => void;
}) {
	const updateBudget = useUpdateMemberBudget(organizationId);

	const [maxApiKeys, setMaxApiKeys] = useState(
		member.budget.maxApiKeys !== null ? String(member.budget.maxApiKeys) : "",
	);
	const [usageLimit, setUsageLimit] = useState(member.budget.usageLimit ?? "");
	const [periodUsageLimit, setPeriodUsageLimit] = useState(
		member.budget.periodUsageLimit ?? "",
	);
	const [periodValue, setPeriodValue] = useState(
		member.budget.periodUsageDurationValue !== null
			? String(member.budget.periodUsageDurationValue)
			: "1",
	);
	const [periodUnit, setPeriodUnit] = useState<(typeof PERIOD_UNITS)[number]>(
		member.budget.periodUsageDurationUnit ?? "month",
	);

	const memberName = member.user.name ?? member.user.email;

	const handleSave = async () => {
		const trimmedPeriodLimit = periodUsageLimit.trim();
		const hasPeriod = trimmedPeriodLimit !== "";

		await updateBudget.mutateAsync({
			params: {
				path: {
					organizationId,
					memberId: member.id,
				},
			},
			body: {
				maxApiKeys: maxApiKeys.trim() === "" ? null : Number(maxApiKeys),
				usageLimit: usageLimit.trim() === "" ? null : usageLimit.trim(),
				periodUsageLimit: hasPeriod ? trimmedPeriodLimit : null,
				periodUsageDurationValue: hasPeriod ? Number(periodValue) : null,
				periodUsageDurationUnit: hasPeriod ? periodUnit : null,
			},
		});

		toast({
			title: "Success",
			description: "Member budget updated successfully",
		});
		onClose();
	};

	return (
		<Dialog open onOpenChange={(o) => (o ? undefined : onClose())}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Manage budget</DialogTitle>
					<DialogDescription>
						Set spend and API-key limits for {memberName}. Limits are enforced
						on the gateway at request time. Leave a field blank for unlimited.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4 py-4">
					<div className="text-muted-foreground grid grid-cols-3 gap-2 text-xs">
						<div>
							<div className="text-foreground font-medium">
								{currencyFormatter.format(member.spend.lifetime)}
							</div>
							Lifetime spend
						</div>
						<div>
							<div className="text-foreground font-medium">
								{member.spend.currentPeriod !== null
									? currencyFormatter.format(member.spend.currentPeriod)
									: "—"}
							</div>
							Period spend
						</div>
						<div>
							<div className="text-foreground font-medium">
								{member.spend.activeApiKeys}
							</div>
							Active API keys
						</div>
					</div>

					<div className="space-y-2">
						<Label htmlFor="max-api-keys">Max active API keys</Label>
						<Input
							id="max-api-keys"
							type="number"
							min={0}
							placeholder="Unlimited"
							value={maxApiKeys}
							onChange={(e) => setMaxApiKeys(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="usage-limit">Total spend limit ($)</Label>
						<Input
							id="usage-limit"
							type="number"
							min={0}
							step="0.01"
							placeholder="Unlimited"
							value={usageLimit}
							onChange={(e) => setUsageLimit(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="period-usage-limit">Period spend limit ($)</Label>
						<Input
							id="period-usage-limit"
							type="number"
							min={0}
							step="0.01"
							placeholder="No period limit"
							value={periodUsageLimit}
							onChange={(e) => setPeriodUsageLimit(e.target.value)}
						/>
						<div className="flex items-center gap-2">
							<span className="text-muted-foreground text-sm">per</span>
							<Input
								type="number"
								min={1}
								className="w-20"
								value={periodValue}
								onChange={(e) => setPeriodValue(e.target.value)}
							/>
							<Select
								value={periodUnit}
								onValueChange={(value) =>
									setPeriodUnit(value as (typeof PERIOD_UNITS)[number])
								}
							>
								<SelectTrigger className="w-[130px]">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PERIOD_UNITS.map((unit) => (
										<SelectItem key={unit} value={unit}>
											{unit}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={handleSave} disabled={updateBudget.isPending}>
						{updateBudget.isPending ? "Saving..." : "Save budget"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

export function TeamClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, buildOrgUrl, selectedOrganization } =
		useDashboardNavigation();
	const api = useApi();
	const { user } = useUser();

	const { data, isLoading } = useTeamMembers(organizationId);
	const addMemberMutation = useAddTeamMember(organizationId);
	const updateMemberMutation = useUpdateTeamMember(organizationId);
	const removeMemberMutation = useRemoveTeamMember(organizationId);

	const currentUserRole = data?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
	const isEnterprise = selectedOrganization?.plan === "enterprise";
	const showUsage = isEnterprise && isAdmin;

	const [email, setEmail] = useState("");
	const [role, setRole] = useState<"owner" | "admin" | "developer">(
		"developer",
	);
	const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
	const [budgetMember, setBudgetMember] = useState<TeamMember | null>(null);

	useEffect(() => {
		if (!showUsage) {
			return;
		}
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const params2 = new URLSearchParams(searchParams.toString());
			params2.delete("days");
			const today = new Date();
			params2.set("from", format(subDays(today, 6), "yyyy-MM-dd"));
			params2.set("to", format(today, "yyyy-MM-dd"));
			router.replace(
				`${buildOrgUrl("org/team")}?${params2.toString()}` as Route,
			);
		}
	}, [showUsage, searchParams, router, buildOrgUrl]);

	const fromStr =
		searchParams.get("from") ?? format(subDays(new Date(), 6), "yyyy-MM-dd");
	const toStr = searchParams.get("to") ?? format(new Date(), "yyyy-MM-dd");

	const { data: usageData } = api.useQuery(
		"get",
		"/analytics/members",
		{ params: { query: { organizationId, from: fromStr, to: toStr } } },
		{ enabled: !!organizationId && showUsage },
	);

	const usageByUserId = new Map(
		(usageData?.members ?? []).map((member) => [member.userId, member]),
	);

	const usageColumnCount = 4;
	// Name, Email, Role, Limits, Actions
	const baseColumnCount = 5;
	const totalColumnCount = showUsage
		? baseColumnCount + usageColumnCount
		: baseColumnCount;

	const handleAddMember = async () => {
		if (!email) {
			toast({
				title: "Error",
				description: "Please enter an email address",
				variant: "destructive",
			});
			return;
		}

		await addMemberMutation.mutateAsync({
			params: {
				path: {
					organizationId,
				},
			},
			body: { email, role },
		});
		toast({
			title: "Success",
			description: "Team member added successfully",
		});
		setEmail("");
		setRole("developer");
		setIsAddDialogOpen(false);
	};

	const handleUpdateRole = async (
		memberId: string,
		newRole: "owner" | "admin" | "developer",
	) => {
		await updateMemberMutation.mutateAsync({
			params: {
				path: {
					organizationId,
					memberId,
				},
			},
			body: {
				role: newRole,
			},
		});
		toast({
			title: "Success",
			description: "Role updated successfully",
		});
	};

	const handleRemoveMember = async (memberId: string, memberName: string) => {
		const confirmed = window.confirm(
			`Are you sure you want to remove ${memberName} from the team?`,
		);

		if (!confirmed) {
			return;
		}

		await removeMemberMutation.mutateAsync({
			params: {
				path: {
					organizationId,
					memberId,
				},
			},
		});
		toast({
			title: "Success",
			description: "Team member removed successfully",
		});
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="space-y-4">
					<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
						<div>
							<h2 className="text-3xl font-bold tracking-tight">Team</h2>
							<p className="text-muted-foreground">
								Manage your organization's members and their roles
								{showUsage ? ", and track usage per member" : ""}.
							</p>
						</div>
						<div className="flex items-center gap-2">
							{showUsage && (
								<DateRangePicker buildUrl={buildOrgUrl} path="org/team" />
							)}
							<Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
								<DialogTrigger asChild>
									<Button disabled={(data?.members.length ?? 0) >= 5}>
										Add Member
									</Button>
								</DialogTrigger>
								<DialogContent>
									<DialogHeader>
										<DialogTitle>Add Team Member</DialogTitle>
										<DialogDescription>
											Add a new member to your organization by entering their
											email address.
										</DialogDescription>
									</DialogHeader>
									<div className="space-y-4 py-4">
										<div className="space-y-2">
											<Label htmlFor="email">Email</Label>
											<Input
												id="email"
												type="email"
												placeholder="user@example.com"
												value={email}
												onChange={(e) => setEmail(e.target.value)}
											/>
										</div>
										<div className="space-y-2">
											<Label htmlFor="role">Role</Label>
											<Select
												value={role}
												onValueChange={(value) =>
													setRole(value as "owner" | "admin" | "developer")
												}
											>
												<SelectTrigger>
													<SelectValue placeholder="Select a role" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="developer">Developer</SelectItem>
													<SelectItem value="admin">Admin</SelectItem>
													<SelectItem value="owner">Owner</SelectItem>
												</SelectContent>
											</Select>
										</div>

										<Alert>
											<AlertDescription>
												Organizations can have up to 5 team members. Contact us
												at{" "}
												<a
													href="mailto:contact@llmgateway.io"
													className="underline"
												>
													contact@llmgateway.io
												</a>{" "}
												to unlock more seats.
											</AlertDescription>
										</Alert>
									</div>
									<DialogFooter>
										<Button
											variant="outline"
											onClick={() => setIsAddDialogOpen(false)}
										>
											Cancel
										</Button>
										<Button
											onClick={handleAddMember}
											disabled={addMemberMutation.isPending}
										>
											{addMemberMutation.isPending ? "Adding..." : "Add Member"}
										</Button>
									</DialogFooter>
								</DialogContent>
							</Dialog>
						</div>
					</div>

					{showUsage && <ApiKeyAnalyticsCallout href={buildUrl("api-keys")} />}

					{!isEnterprise && <MemberUsageUpsell />}

					<Card>
						<CardHeader>
							<CardTitle>Team Members</CardTitle>
							<CardDescription>
								Manage your organization's team members and their roles (
								{data?.members.length ?? 0}/5 seats used)
								{showUsage
									? ". Cost is attributed to the member who created each API key."
									: ""}
							</CardDescription>
						</CardHeader>
						<CardContent>
							{isLoading ? (
								<div>Loading...</div>
							) : (
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
											<TableHead>Limits</TableHead>
											{showUsage && (
												<>
													<TableHead className="text-right">Cost</TableHead>
													<TableHead className="text-right">Tokens</TableHead>
													<TableHead className="text-right">Requests</TableHead>
													<TableHead className="text-right">API keys</TableHead>
												</>
											)}
											<TableHead className="text-right">Actions</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{(data?.members.length ?? 0) === 0 ? (
											<TableRow>
												<TableCell
													colSpan={totalColumnCount}
													className="text-muted-foreground py-10 text-center"
												>
													No members found
												</TableCell>
											</TableRow>
										) : (
											data?.members.map((member) => {
												const usage = usageByUserId.get(member.userId);
												const displayName = member.user.name ?? "—";
												return (
													<TableRow key={member.id}>
														<TableCell>
															<Link
																href={
																	`${buildOrgUrl(
																		`org/team/${member.userId}`,
																	)}?from=${fromStr}&to=${toStr}` as Route
																}
																className="font-medium hover:underline"
															>
																{displayName}
															</Link>
														</TableCell>
														<TableCell>{member.user.email}</TableCell>
														<TableCell>
															<Select
																value={member.role}
																onValueChange={(value) =>
																	handleUpdateRole(
																		member.id,
																		value as "owner" | "admin" | "developer",
																	)
																}
																disabled={updateMemberMutation.isPending}
															>
																<SelectTrigger className="w-[130px]">
																	<SelectValue />
																</SelectTrigger>
																<SelectContent>
																	<SelectItem value="developer">
																		Developer
																	</SelectItem>
																	<SelectItem value="admin">Admin</SelectItem>
																	<SelectItem value="owner">Owner</SelectItem>
																</SelectContent>
															</Select>
														</TableCell>
														<TableCell>
															{(() => {
																const badges = budgetBadges(member.budget);
																return badges.length ? (
																	<div className="flex flex-wrap gap-1">
																		{badges.map((badge) => (
																			<Badge
																				key={badge}
																				variant="secondary"
																				className="font-normal"
																			>
																				{badge}
																			</Badge>
																		))}
																	</div>
																) : (
																	<span className="text-muted-foreground">
																		—
																	</span>
																);
															})()}
														</TableCell>
														{showUsage && (
															<>
																<TableCell className="text-right font-medium">
																	{currencyFormatter.format(usage?.cost ?? 0)}
																</TableCell>
																<TableCell className="text-right">
																	{(usage?.totalTokens ?? 0).toLocaleString()}
																</TableCell>
																<TableCell className="text-right">
																	{(usage?.requestCount ?? 0).toLocaleString()}
																</TableCell>
																<TableCell className="text-right">
																	{usage?.apiKeyCount ?? 0}
																</TableCell>
															</>
														)}
														<TableCell className="text-right">
															<div className="flex items-center justify-end gap-2">
																<Button asChild variant="outline" size="sm">
																	<Link
																		href={
																			`${buildOrgUrl(
																				`org/team/${member.userId}`,
																			)}?from=${fromStr}&to=${toStr}` as Route
																		}
																		prefetch={true}
																	>
																		Details
																	</Link>
																</Button>
																{isAdmin && (
																	<Button
																		variant="outline"
																		size="sm"
																		onClick={() => setBudgetMember(member)}
																	>
																		Manage budget
																	</Button>
																)}
																<Button
																	variant="destructive"
																	size="sm"
																	onClick={() =>
																		handleRemoveMember(
																			member.id,
																			member.user.name ?? member.user.email,
																		)
																	}
																	disabled={removeMemberMutation.isPending}
																>
																	Remove
																</Button>
															</div>
														</TableCell>
													</TableRow>
												);
											})
										)}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
			{budgetMember && (
				<ManageBudgetDialog
					key={budgetMember.id}
					organizationId={organizationId}
					member={budgetMember}
					onClose={() => setBudgetMember(null)}
				/>
			)}
		</div>
	);
}
