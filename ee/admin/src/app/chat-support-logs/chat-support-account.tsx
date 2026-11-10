import { Building2, ExternalLink, UserX } from "lucide-react";
import Link from "next/link";

import { AccountRiskAlert } from "@/components/account-risk-alert";
import { Badge } from "@/components/ui/badge";

import type { paths } from "@/lib/api/v1";

type ChatSupportAccountData =
	paths["/admin/chat-support-logs/{id}"]["get"]["responses"][200]["content"]["application/json"]["account"];

const KIND_LABELS: Record<
	NonNullable<ChatSupportAccountData>["organizations"][number]["kind"],
	string
> = {
	default: "Gateway",
	chat: "Chat",
	devpass: "DevPass",
};

interface ChatSupportAccountProps {
	account: ChatSupportAccountData;
	email: string | null;
	canManage: boolean;
	onActivated: () => void;
}

/** The visitor's account: restrictions, the approve action and their orgs. */
export function ChatSupportAccount({
	account,
	email,
	canManage,
	onActivated,
}: ChatSupportAccountProps) {
	if (!account) {
		return email ? (
			<p className="mb-3 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
				No account matches this email.
			</p>
		) : null;
	}

	const { organizations } = account;
	const riskFlagged =
		account.risk.status === "flagged" ||
		organizations.some((org) => org.riskFlagged);

	return (
		<div className="mb-3 flex flex-col gap-3">
			{riskFlagged ? (
				<AccountRiskAlert
					userId={account.userId}
					email={account.email}
					risk={account.risk}
					title="Restricted — flagged as high risk"
					canApprove={canManage}
					organizationCount={organizations.length}
					onActivated={onActivated}
				/>
			) : null}
			{account.status === "deactivated" ? (
				<div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
					<div className="flex items-center gap-2">
						<UserX className="h-4 w-4 shrink-0 text-destructive" />
						<span className="text-xs font-semibold text-destructive">
							User deactivated
						</span>
					</div>
					{account.blockReason ? (
						<p className="mt-1 text-xs text-muted-foreground">
							{account.blockReason}
						</p>
					) : null}
				</div>
			) : null}
			<div>
				<h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
					Organizations
				</h3>
				{organizations.length ? (
					<div className="flex flex-col gap-1.5">
						{organizations.map((org) => {
							const inactive = org.status !== null && org.status !== "active";
							return (
								<Link
									key={org.id}
									href={`/organizations/${org.id}`}
									className="flex items-start gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-xs transition-colors hover:bg-muted"
								>
									<Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium text-foreground">
											{org.name}
										</p>
										<div className="mt-1 flex flex-wrap gap-1">
											<Badge variant="secondary">{KIND_LABELS[org.kind]}</Badge>
											{org.plan !== "free" ? (
												<Badge variant="outline">{org.plan}</Badge>
											) : null}
											{org.devPlan !== "none" ? (
												<Badge variant="outline">Dev: {org.devPlan}</Badge>
											) : null}
											<Badge variant="outline">{org.role}</Badge>
											{org.riskFlagged ? (
												<Badge variant="destructive">High risk</Badge>
											) : null}
											{inactive ? (
												<Badge variant="destructive">{org.status}</Badge>
											) : null}
										</div>
										{inactive && org.blockReason ? (
											<p className="mt-1 text-muted-foreground">
												{org.blockReason}
											</p>
										) : null}
									</div>
									<ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
								</Link>
							);
						})}
					</div>
				) : (
					<p className="text-xs text-muted-foreground">No organizations.</p>
				)}
			</div>
		</div>
	);
}
