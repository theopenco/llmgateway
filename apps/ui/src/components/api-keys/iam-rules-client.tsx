"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Info, Shield } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

import { IamRulesEditor } from "@/components/iam/iam-rules-editor";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useMyIamRules } from "@/hooks/useTeam";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";
import { extractOrgAndProjectFromPath } from "@/lib/navigation-utils";

import type { IamRule } from "@/components/iam/iam-rules-editor";
import type { ApiKey } from "@/lib/types";
import type { Route } from "next";

export type { IamRule } from "@/components/iam/iam-rules-editor";

interface IamRulesClientProps {
	apiKey: ApiKey;
}

export function IamRulesClient({ apiKey }: IamRulesClientProps) {
	const pathname = usePathname();
	const { orgId, projectId } = useMemo(
		() => extractOrgAndProjectFromPath(pathname),
		[pathname],
	);
	const { selectedOrganization } = useDashboardNavigation();
	const isEnterprise = selectedOrganization?.plan === "enterprise";

	const queryClient = useQueryClient();
	const api = useApi();

	// Fetch IAM rules for this API key
	const { data: rulesData, isLoading } = api.useQuery(
		"get",
		"/keys/api/{id}/iam",
		{
			params: {
				path: { id: apiKey.id },
			},
		},
	);

	// Member-level rules set by the org admin apply on top of key rules; surface
	// them so the key owner understands denials that no key rule explains.
	const { data: myRulesData } = useMyIamRules(orgId ?? "");
	const hasMemberRules = (myRulesData?.rules ?? []).some(
		(rule) => rule.status === "active",
	);

	// Mutations
	const { mutate: createRule, isPending: isCreating } = api.useMutation(
		"post",
		"/keys/api/{id}/iam",
	);
	const { mutate: deleteRule } = api.useMutation(
		"delete",
		"/keys/api/{id}/iam/{ruleId}",
	);

	const invalidateRules = () => {
		void queryClient.invalidateQueries({
			queryKey: api.queryOptions("get", "/keys/api/{id}/iam", {
				params: { path: { id: apiKey.id } },
			}).queryKey,
		});
	};

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
				params: { path: { id: apiKey.id } },
				body: rule,
			},
			{
				onSuccess: () => {
					invalidateRules();
					callbacks.onSuccess();
					toast({ title: "IAM rule created successfully" });
				},
			},
		);
	};

	const handleDeleteRule = (ruleId: string) => {
		deleteRule(
			{
				params: { path: { id: apiKey.id, ruleId } },
			},
			{
				onSuccess: () => {
					invalidateRules();
					toast({ title: "IAM rule deleted successfully" });
				},
			},
		);
	};

	const backUrl = `/dashboard/${orgId}/${projectId}/api-keys`;

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
						Back to API Keys
					</Link>
					<div className="flex items-start gap-3">
						<div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
							<Shield className="h-6 w-6 text-primary" />
						</div>
						<div className="flex-1">
							<h1 className="text-balance text-2xl font-bold tracking-tight">
								IAM Rules
							</h1>
							<p className="mt-1 text-pretty text-sm text-muted-foreground">
								Configure access control rules for{" "}
								<span className="font-medium text-foreground">
									{apiKey.description}
								</span>
							</p>
						</div>
					</div>
				</div>

				<div className="space-y-5 p-6">
					{hasMemberRules && (
						<div className="flex items-start gap-3 rounded-lg border border-border/50 bg-muted/30 p-4">
							<Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
							<p className="text-sm text-muted-foreground">
								Organization-level IAM restrictions set by your admin also apply
								to requests with this key. Key rules can only further restrict
								access, never expand it.
							</p>
						</div>
					)}

					<IamRulesEditor
						rules={rulesData?.rules}
						isLoading={isLoading}
						isEnterprise={isEnterprise}
						onCreateRule={handleCreateRule}
						isCreating={isCreating}
						onDeleteRule={handleDeleteRule}
						listDescription="Manage the access control rules for this API key."
					/>
				</div>
			</div>
		</div>
	);
}
