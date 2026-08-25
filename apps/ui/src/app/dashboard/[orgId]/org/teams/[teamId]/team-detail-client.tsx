"use client";

import { ArrowLeft, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { IamRulesEditor } from "@/components/iam/iam-rules-editor";
import {
	ProjectMultiSelect,
	type OrgProject,
} from "@/components/projects/project-multi-select";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	useAssignOrganizationTeam,
	useCreateOrganizationTeamIamRule,
	useDeleteOrganizationTeam,
	useDeleteOrganizationTeamIamRule,
	useOrganizationTeam,
	useUpdateOrganizationTeam,
	useUpdateOrganizationTeamBudget,
	useUpdateOrganizationTeamProjects,
} from "@/hooks/useOrganizationTeams";
import { useTeamMembers } from "@/hooks/useTeam";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/lib/components/alert-dialog";
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

import type { IamRule } from "@/components/iam/iam-rules-editor";
import type { Route } from "next";

const periodUnits = ["hour", "day", "week", "month"] as const;
const nonNegativeDecimalPattern = /^\d+(?:\.\d+)?$/;

type Confirmation =
	| { type: "projects" }
	| {
			type: "membership";
			memberId: string;
			memberName: string;
			currentTeamName: string | null;
			nextTeamId: string | null;
	  }
	| { type: "delete" };

export function OrganizationTeamDetailClient() {
	const params = useParams<{ orgId: string; teamId: string }>();
	const organizationId = params.orgId;
	const teamId = params.teamId;
	const router = useRouter();
	const api = useApi();
	const { buildOrgUrl, selectedOrganization } = useDashboardNavigation();
	const isEnterprise = selectedOrganization?.enterpriseAccess === true;
	const backUrl = `${buildOrgUrl("org/team")}?tab=teams` as Route;

	const { data, isLoading, isError, refetch } = useOrganizationTeam(
		organizationId,
		teamId,
	);
	const { data: memberData } = useTeamMembers(organizationId);
	const updateTeam = useUpdateOrganizationTeam(organizationId, teamId);
	const deleteTeam = useDeleteOrganizationTeam(organizationId, teamId);
	const updateProjects = useUpdateOrganizationTeamProjects(
		organizationId,
		teamId,
	);
	const updateBudget = useUpdateOrganizationTeamBudget(organizationId, teamId);
	const assignMember = useAssignOrganizationTeam(organizationId);
	const createIamRule = useCreateOrganizationTeamIamRule(
		organizationId,
		teamId,
	);
	const deleteIamRule = useDeleteOrganizationTeamIamRule(
		organizationId,
		teamId,
	);

	const { data: projectsData } = api.useQuery(
		"get",
		"/orgs/{id}/projects",
		{ params: { path: { id: organizationId } } },
		{ enabled: !!organizationId },
	);
	const orgProjects: OrgProject[] = (projectsData?.projects ?? []).map(
		(project) => ({ id: project.id, name: project.name }),
	);

	const team = data?.team;
	const [name, setName] = useState("");
	const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
	const [maxApiKeys, setMaxApiKeys] = useState("");
	const [usageLimit, setUsageLimit] = useState("");
	const [periodLimit, setPeriodLimit] = useState("");
	const [periodValue, setPeriodValue] = useState("1");
	const [periodUnit, setPeriodUnit] =
		useState<(typeof periodUnits)[number]>("month");
	const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

	useEffect(() => {
		if (!team) {
			return;
		}
		setName(team.name);
		setSelectedProjects(team.projects.map((project) => project.id));
		setMaxApiKeys(
			team.budget.maxApiKeys === null ? "" : String(team.budget.maxApiKeys),
		);
		setUsageLimit(team.budget.usageLimit ?? "");
		setPeriodLimit(team.budget.periodUsageLimit ?? "");
		setPeriodValue(String(team.budget.periodUsageDurationValue ?? 1));
		setPeriodUnit(team.budget.periodUsageDurationUnit ?? "month");
	}, [team]);

	if (isLoading) {
		return (
			<div className="p-8 text-sm text-muted-foreground">Loading team…</div>
		);
	}
	if (isError || !team) {
		return (
			<div className="flex min-h-64 flex-col items-center justify-center gap-3 p-8 text-center">
				<p className="font-medium">This team could not be loaded</p>
				<p className="text-muted-foreground text-sm">
					It may have been deleted, or the request may have failed.
				</p>
				<div className="flex gap-2">
					<Button variant="outline" asChild>
						<Link href={backUrl}>Back to teams</Link>
					</Button>
					<Button onClick={() => void refetch()}>Try again</Button>
				</div>
			</div>
		);
	}

	const eligibleMembers =
		memberData?.members.filter(
			(member) => member.role === "developer" && member.team?.id !== teamId,
		) ?? [];

	const saveName = async () => {
		await updateTeam.mutateAsync({
			params: { path: { organizationId, teamId } },
			body: { name: name.trim() },
		});
		toast({ title: "Team name saved" });
	};

	const applyProjects = async () => {
		await updateProjects.mutateAsync({
			params: { path: { organizationId, teamId } },
			body: { projectIds: selectedProjects },
		});
		toast({
			title: "Project policy saved",
			description: selectedProjects.length
				? "Members now receive the intersection of team and personal access."
				: "All team member project and gateway access is now suspended.",
		});
	};

	const saveProjects = () => {
		if (team.projects.length > 0 && selectedProjects.length === 0) {
			setConfirmation({ type: "projects" });
			return;
		}
		void applyProjects();
	};

	const saveBudget = async () => {
		const hasPeriod = periodLimit.trim() !== "";
		const normalizedMaxApiKeys = maxApiKeys.trim();
		const normalizedUsageLimit = usageLimit.trim();
		const normalizedPeriodLimit = periodLimit.trim();
		const normalizedPeriodValue = periodValue.trim();
		if (
			(normalizedMaxApiKeys !== "" &&
				(!Number.isInteger(Number(normalizedMaxApiKeys)) ||
					Number(normalizedMaxApiKeys) < 0)) ||
			(normalizedUsageLimit !== "" &&
				!nonNegativeDecimalPattern.test(normalizedUsageLimit)) ||
			(normalizedPeriodLimit !== "" &&
				!nonNegativeDecimalPattern.test(normalizedPeriodLimit)) ||
			(hasPeriod &&
				(!Number.isInteger(Number(normalizedPeriodValue)) ||
					Number(normalizedPeriodValue) < 1))
		) {
			toast({
				title: "Enter valid budget ceilings",
				description:
					"Spend must be non-negative and windows use whole numbers.",
				variant: "destructive",
			});
			return;
		}
		await updateBudget.mutateAsync({
			params: { path: { organizationId, teamId } },
			body: {
				maxApiKeys: maxApiKeys.trim() === "" ? null : Number(maxApiKeys),
				usageLimit: usageLimit.trim() || null,
				periodUsageLimit: hasPeriod ? periodLimit.trim() : null,
				periodUsageDurationValue: hasPeriod ? Number(periodValue) : null,
				periodUsageDurationUnit: hasPeriod ? periodUnit : null,
			},
		});
		toast({ title: "Budget ceilings saved" });
	};

	const requestMembershipUpdate = (
		memberId: string,
		memberName: string,
		currentTeamName: string | null,
		nextTeamId: string | null,
	) => {
		setConfirmation({
			type: "membership",
			memberId,
			memberName,
			currentTeamName,
			nextTeamId,
		});
	};

	const applyMembership = async (
		memberId: string,
		nextTeamId: string | null,
	) => {
		await assignMember.mutateAsync({
			params: { path: { organizationId, memberId } },
			body: { teamId: nextTeamId },
		});
		toast({
			title: nextTeamId ? "Developer assigned" : "Developer unassigned",
		});
	};

	const applyDelete = async () => {
		await deleteTeam.mutateAsync({
			params: { path: { organizationId, teamId } },
		});
		router.push(backUrl);
	};

	const confirmPendingAction = async () => {
		if (!confirmation) {
			return;
		}
		if (confirmation.type === "projects") {
			await applyProjects();
		} else if (confirmation.type === "membership") {
			await applyMembership(confirmation.memberId, confirmation.nextTeamId);
		} else {
			await applyDelete();
		}
		setConfirmation(null);
	};

	const confirmationCopy = (() => {
		if (!confirmation) {
			return null;
		}
		if (confirmation.type === "projects") {
			return {
				title: "Suspend all team project access?",
				description:
					"Saving an empty project list blocks all gateway requests from existing user keys owned by this team's developers. Access resumes when a project is restored.",
				action: "Suspend access",
			};
		}
		if (confirmation.type === "delete") {
			return {
				title: `Delete ${team.name}?`,
				description:
					"This permanently removes the team and its project, budget, and IAM policy.",
				action: "Delete team",
			};
		}
		if (confirmation.nextTeamId === null) {
			return {
				title: `Unassign ${confirmation.memberName}?`,
				description:
					"Their personal project, IAM, and budget settings resume immediately and may allow broader access than the current team policy.",
				action: "Unassign developer",
			};
		}
		return {
			title: confirmation.currentTeamName
				? `Move ${confirmation.memberName} to ${team.name}?`
				: `Assign ${confirmation.memberName} to ${team.name}?`,
			description: confirmation.currentTeamName
				? `${confirmation.currentTeamName} policy will stop applying immediately. ${team.name} project, IAM, and budget ceilings will replace it.`
				: `${team.name} project, IAM, and budget ceilings will apply immediately in addition to personal policy.`,
			action: confirmation.currentTeamName
				? "Move developer"
				: "Assign developer",
		};
	})();

	return (
		<div className="mx-auto w-full max-w-7xl space-y-6 p-4 pt-6 md:p-8">
			<div>
				<Link
					href={backUrl}
					className="text-muted-foreground hover:text-foreground mb-4 inline-flex items-center gap-2 text-sm"
				>
					<ArrowLeft className="h-4 w-4" />
					Back to teams
				</Link>
				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div>
						<h1 className="text-3xl font-bold tracking-tight">{team.name}</h1>
						<p className="text-muted-foreground mt-1">
							Shared ceilings for {team.members.length} developer
							{team.members.length === 1 ? "" : "s"}.
						</p>
					</div>
					<div className="space-y-1 md:text-right">
						<Button
							variant="destructive"
							onClick={() => setConfirmation({ type: "delete" })}
							disabled={team.members.length > 0 || deleteTeam.isPending}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete team
						</Button>
						{team.members.length > 0 && (
							<p className="text-muted-foreground text-xs">
								Unassign all developers before deleting.
							</p>
						)}
					</div>
				</div>
			</div>

			{!isEnterprise && (
				<Alert>
					<ShieldAlert className="h-4 w-4" />
					<AlertTitle>Policy is locked</AlertTitle>
					<AlertDescription>
						Existing settings remain enforced. Restore Enterprise access to edit
						policy; member removal and empty-team deletion remain available.
					</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-6 lg:grid-cols-2">
				<Card>
					<CardHeader>
						<CardTitle>Team identity</CardTitle>
						<CardDescription>
							Names are unique within this organization.
						</CardDescription>
					</CardHeader>
					<CardContent className="flex gap-2">
						<Label htmlFor="team-identity-name" className="sr-only">
							Team name
						</Label>
						<Input
							id="team-identity-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							maxLength={100}
							disabled={!isEnterprise}
						/>
						<Button
							onClick={saveName}
							disabled={!isEnterprise || !name.trim() || updateTeam.isPending}
						>
							Save
						</Button>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Project ceiling</CardTitle>
						<CardDescription>
							Effective access is the intersection of this list and each
							developer's personal grants.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{isEnterprise ? (
							<ProjectMultiSelect
								orgProjects={orgProjects}
								selected={selectedProjects}
								onChange={setSelectedProjects}
							/>
						) : (
							<div className="flex flex-wrap gap-1.5">
								{team.projects.map((project) => (
									<Badge key={project.id} variant="secondary">
										{project.name}
									</Badge>
								))}
							</div>
						)}
						{selectedProjects.length === 0 && (
							<p className="text-destructive text-sm">
								No projects selected. Existing user keys for this team will
								return 403.
							</p>
						)}
						<Button
							onClick={saveProjects}
							disabled={!isEnterprise || updateProjects.isPending}
						>
							Save projects
						</Button>
					</CardContent>
				</Card>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Per-developer budget ceilings</CardTitle>
					<CardDescription>
						These limits apply to each member separately. Personal and API-key
						limits may be stricter.
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
					<div className="space-y-2">
						<Label htmlFor="team-max-keys">Active keys</Label>
						<Input
							id="team-max-keys"
							type="number"
							min="0"
							value={maxApiKeys}
							onChange={(event) => setMaxApiKeys(event.target.value)}
							disabled={!isEnterprise}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="team-total">Lifetime spend (USD)</Label>
						<Input
							id="team-total"
							inputMode="decimal"
							value={usageLimit}
							onChange={(event) => setUsageLimit(event.target.value)}
							disabled={!isEnterprise}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="team-period">Recurring spend (USD)</Label>
						<Input
							id="team-period"
							inputMode="decimal"
							value={periodLimit}
							onChange={(event) => setPeriodLimit(event.target.value)}
							disabled={!isEnterprise}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="team-window">Window</Label>
						<Input
							id="team-window"
							type="number"
							min="1"
							value={periodValue}
							onChange={(event) => setPeriodValue(event.target.value)}
							disabled={!isEnterprise || !periodLimit}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="team-period-unit">Unit</Label>
						<Select
							value={periodUnit}
							onValueChange={(value) =>
								setPeriodUnit(value as typeof periodUnit)
							}
							disabled={!isEnterprise || !periodLimit}
						>
							<SelectTrigger id="team-period-unit">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{periodUnits.map((unit) => (
									<SelectItem key={unit} value={unit}>
										{unit}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="md:col-span-2 lg:col-span-5">
						<Button
							onClick={saveBudget}
							disabled={!isEnterprise || updateBudget.isPending}
						>
							Save budget
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Developers</CardTitle>
					<CardDescription>
						Owners and admins cannot be assigned, preventing privileged lockout.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{isEnterprise && eligibleMembers.length > 0 && (
						<div className="flex flex-col gap-2 sm:flex-row">
							<Label htmlFor="team-member-assignment" className="sr-only">
								Assign a developer
							</Label>
							<Select
								onValueChange={(memberId) => {
									const member = eligibleMembers.find(
										(candidate) => candidate.id === memberId,
									);
									if (member) {
										requestMembershipUpdate(
											member.id,
											member.user.name ?? member.user.email,
											member.team?.name ?? null,
											teamId,
										);
									}
								}}
								disabled={assignMember.isPending}
							>
								<SelectTrigger
									id="team-member-assignment"
									className="sm:max-w-sm"
								>
									<SelectValue placeholder="Assign a developer" />
								</SelectTrigger>
								<SelectContent>
									{eligibleMembers.map((member) => (
										<SelectItem key={member.id} value={member.id}>
											{member.user.name ?? member.user.email}
											{member.team ? ` — move from ${member.team.name}` : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
					<div className="space-y-3 sm:hidden">
						{team.members.length ? (
							team.members.map((member) => (
								<div
									key={member.id}
									className="border-border space-y-3 rounded-lg border p-3"
								>
									<div className="min-w-0">
										<p className="font-medium">{member.name ?? "—"}</p>
										<p className="text-muted-foreground truncate text-sm">
											{member.email}
										</p>
									</div>
									<Button
										variant="outline"
										size="sm"
										className="w-full"
										onClick={() =>
											requestMembershipUpdate(
												member.id,
												member.name ?? member.email,
												team.name,
												null,
											)
										}
										disabled={assignMember.isPending}
									>
										Unassign
									</Button>
								</div>
							))
						) : (
							<p className="text-muted-foreground py-6 text-center text-sm">
								No developers assigned
							</p>
						)}
					</div>
					<Table className="hidden sm:table">
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Email</TableHead>
								<TableHead className="text-right">Action</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{team.members.length ? (
								team.members.map((member) => (
									<TableRow key={member.id}>
										<TableCell className="font-medium">
											{member.name ?? "—"}
										</TableCell>
										<TableCell>{member.email}</TableCell>
										<TableCell className="text-right">
											<Button
												variant="outline"
												size="sm"
												onClick={() =>
													requestMembershipUpdate(
														member.id,
														member.name ?? member.email,
														team.name,
														null,
													)
												}
												disabled={assignMember.isPending}
											>
												Unassign
											</Button>
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell
										colSpan={3}
										className="text-muted-foreground py-8 text-center"
									>
										No developers assigned
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>IAM policy</CardTitle>
					<CardDescription>
						Team rules run before member and API-key rules. A lower layer can
						only narrow access.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<IamRulesEditor
						rules={team.iamRules as IamRule[]}
						isLoading={false}
						isCreating={createIamRule.isPending}
						isEnterprise={isEnterprise}
						readOnly={!isEnterprise}
						createDescription="Add a shared model, provider, pricing, or IP restriction for every developer in this team."
						onCreateRule={(rule, callbacks) =>
							createIamRule.mutate(
								{ params: { path: { organizationId, teamId } }, body: rule },
								{
									onSuccess: () => {
										callbacks.onSuccess();
										toast({ title: "Team IAM rule created" });
									},
								},
							)
						}
						onDeleteRule={(ruleId) =>
							deleteIamRule.mutate(
								{ params: { path: { organizationId, teamId, ruleId } } },
								{ onSuccess: () => toast({ title: "Team IAM rule deleted" }) },
							)
						}
					/>
				</CardContent>
			</Card>

			<AlertDialog
				open={confirmation !== null}
				onOpenChange={(open) => {
					if (!open && !assignMember.isPending && !updateProjects.isPending) {
						setConfirmation(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{confirmationCopy?.title}</AlertDialogTitle>
						<AlertDialogDescription>
							{confirmationCopy?.description}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void confirmPendingAction()}
							className={
								confirmation?.type === "delete" ||
								confirmation?.type === "projects"
									? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
									: undefined
							}
						>
							{confirmationCopy?.action}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
