import { ShieldAlert } from "lucide-react";

import { ActivateFlaggedAccountButton } from "@/components/activate-flagged-account-button";
import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";
import type { ReactNode } from "react";

export type AccountRisk = NonNullable<
	paths["/admin/chat-support-logs/{id}"]["get"]["responses"][200]["content"]["application/json"]["account"]
>["risk"];

const SOURCE_LABELS: Record<NonNullable<AccountRisk["source"]>, string> = {
	signup: "sign-up",
	email_verification: "email verification",
};

function formatFlaggedAt(value: string) {
	return new Date(value).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

interface AccountRiskAlertProps {
	userId: string;
	email: string;
	risk: AccountRisk;
	title: string;
	canApprove: boolean;
	organizationCount?: number;
	onActivated?: () => void;
	className?: string;
	children?: ReactNode;
}

/**
 * Why an account was flagged by the abuse-IP check, with the button that
 * approves it and unblocks its organizations.
 */
export function AccountRiskAlert({
	userId,
	email,
	risk,
	title,
	canApprove,
	organizationCount,
	onActivated,
	className,
	children,
}: AccountRiskAlertProps) {
	const ipDetails = [
		risk.ipAddress ? `IP ${risk.ipAddress}` : null,
		risk.abuseConfidenceScore !== null
			? `abuse score ${risk.abuseConfidenceScore}%`
			: null,
		risk.countryCode,
	].filter(Boolean);

	return (
		<div
			className={cn(
				"rounded-lg border border-destructive/40 bg-destructive/10 p-3",
				className,
			)}
		>
			<div className="flex items-center gap-2">
				<ShieldAlert className="h-4 w-4 shrink-0 text-destructive" />
				<span className="text-xs font-semibold text-destructive">{title}</span>
			</div>
			<p className="mt-1 break-all text-xs text-muted-foreground">
				{email}
				{risk.flaggedAt
					? ` · flagged ${risk.source ? `at ${SOURCE_LABELS[risk.source]} ` : ""}on ${formatFlaggedAt(risk.flaggedAt)}`
					: null}
			</p>
			{ipDetails.length ? (
				<p className="mt-0.5 text-xs text-muted-foreground">
					{ipDetails.join(" · ")}
				</p>
			) : null}
			{children}
			{canApprove ? (
				<ActivateFlaggedAccountButton
					userId={userId}
					email={email}
					organizationCount={organizationCount}
					label="Approve account"
					className="mt-3 w-full"
					onActivated={onActivated}
				/>
			) : null}
		</div>
	);
}
