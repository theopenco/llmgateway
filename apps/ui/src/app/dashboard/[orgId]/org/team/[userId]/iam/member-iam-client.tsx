"use client";

import { ArrowLeft, Shield } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { IamRulesEditor } from "@/components/iam/iam-rules-editor";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	useCreateMemberIamRule,
	useDeleteMemberIamRule,
	useMemberIamRules,
	useTeamMembers,
} from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { toast } from "@/lib/components/use-toast";

import type { IamRule } from "@/components/iam/iam-rules-editor";
import type { Route } from "next";

export function MemberIamClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const userId = params.userId as string;
	const { buildOrgUrl, selectedOrganization } = useDashboardNavigation();
	const isEnterprise = selectedOrganization?.plan === "enterprise";
	const { user } = useUser();

	const { data: teamData, isLoading: isTeamLoading } =
		useTeamMembers(organizationId);
	const teamMember = teamData?.members.find(
		(member) => member.userId === userId,
	);
	const memberId = teamMember?.id ?? "";
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";

	const { data: rulesData, isLoading: isRulesLoading } = useMemberIamRules(
		organizationId,
		memberId,
	);
	const { mutate: createRule, isPending: isCreating } = useCreateMemberIamRule(
		organizationId,
		memberId,
	);
	const { mutate: deleteRule } = useDeleteMemberIamRule(
		organizationId,
		memberId,
	);

	const handleCreateRule = (
		rule: {
			ruleType: IamRule["ruleType"];
			ruleValue: IamRule["ruleValue"];
			status: "active";
		},
		callbacks: { onSuccess: () => void },
	) => {
		createRule(
			{
				params: { path: { organizationId, memberId } },
				body: rule,
			},
			{
				onSuccess: () => {
					callbacks.onSuccess();
					toast({ title: "IAM rule created successfully" });
				},
			},
		);
	};

	const handleDeleteRule = (ruleId: string) => {
		deleteRule(
			{
				params: { path: { organizationId, memberId, ruleId } },
			},
			{
				onSuccess: () => {
					toast({ title: "IAM rule deleted successfully" });
				},
			},
		);
	};

	const backUrl = buildOrgUrl("org/team");
	const memberLabel =
		teamMember?.user.name || teamMember?.user.email || "this member";

	return (
		<div className="flex min-h-screen flex-col bg-background">
			<div className="mx-auto w-full max-w-7xl">
				{/* Header */}
				<div className="border-b border-border/40 bg-card/50 px-6 py-6 backdrop-blur-sm">
					<Link
						href={backUrl as Route}
						className="group mb-4 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
					>
						<ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
						Back to Team
					</Link>
					<div className="flex items-start gap-3">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
							<Shield className="h-6 w-6 text-primary" />
						</div>
						<div className="flex-1">
							<h1 className="text-balance text-2xl font-bold tracking-tight">
								Member IAM Rules
							</h1>
							<p className="mt-1 text-pretty text-sm text-muted-foreground">
								Configure organization-wide access control rules for{" "}
								<span className="font-medium text-foreground">
									{memberLabel}
								</span>
								. These apply to all of their API keys; their key rules can only
								further restrict access, never expand it.
							</p>
						</div>
					</div>
				</div>

				<div className="p-6">
					{isTeamLoading ? (
						<div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
							Loading member...
						</div>
					) : !teamMember ? (
						<div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
							Member not found.
						</div>
					) : !isAdmin ? (
						<div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
							Only owners and admins can manage member IAM rules.
						</div>
					) : (
						<IamRulesEditor
							rules={rulesData?.rules}
							isLoading={isRulesLoading}
							isEnterprise={isEnterprise}
							onCreateRule={handleCreateRule}
							isCreating={isCreating}
							onDeleteRule={handleDeleteRule}
							createDescription="Restrict which models, providers, pricing tiers, or IP ranges this member can use across the organization."
							listDescription="Manage the organization-level access control rules for this member."
							emptyMessage="No restrictions apply. Create a rule above to limit this member's access."
						/>
					)}
				</div>
			</div>
		</div>
	);
}
