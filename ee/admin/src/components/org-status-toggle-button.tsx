"use client";

import { Ban, CircleCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface OrgStatusToggleButtonProps {
	orgId: string;
	orgName: string;
	currentStatus: "active" | "deleted" | string | null | undefined;
	/**
	 * Why disabling is refused, surfaced as the tooltip. Set when the
	 * organization still has credits. Only gates the disable direction —
	 * re-enabling an already-disabled organization is always allowed.
	 */
	disableBlockedReason?: string | null;
	onToggle: (
		orgId: string,
		status: "active" | "deleted",
	) => Promise<{ success: boolean; error?: string }>;
}

export function OrgStatusToggleButton({
	orgId,
	orgName,
	currentStatus,
	disableBlockedReason,
	onToggle,
}: OrgStatusToggleButtonProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const isDisabled = currentStatus === "deleted";
	const nextStatus: "active" | "deleted" = isDisabled ? "active" : "deleted";
	const blockedReason = isDisabled ? null : (disableBlockedReason ?? null);
	const tooltip =
		blockedReason ??
		(isDisabled
			? "Re-enable organization access only; member accounts and subscriptions are not restored"
			: "Disable organization and cancel all subscriptions; member accounts stay active");

	const handleClick = async () => {
		const verb = isDisabled ? "re-enable" : "disable";
		if (
			!confirm(
				`Are you sure you want to ${verb} organization "${orgName}"? ${
					isDisabled
						? "Organization access will resume. Cancelled subscriptions and deactivated member accounts will not be restored."
						: "All Stripe subscriptions will be cancelled and gateway requests will be rejected with HTTP 410. Member accounts will stay active."
				}`,
			)
		) {
			return;
		}

		setLoading(true);
		const result = await onToggle(orgId, nextStatus);
		setLoading(false);

		if (result.success) {
			router.refresh();
		} else if (result.error) {
			alert(result.error);
		}
	};

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex">
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={
							isDisabled ? "Re-enable organization" : "Disable organization"
						}
						onClick={handleClick}
						disabled={loading || blockedReason !== null}
						className={
							isDisabled
								? "text-emerald-600 hover:text-emerald-600"
								: "text-amber-600 hover:text-amber-600"
						}
					>
						{loading ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : isDisabled ? (
							<CircleCheck className="h-4 w-4" />
						) : (
							<Ban className="h-4 w-4" />
						)}
					</Button>
				</span>
			</TooltipTrigger>
			<TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
		</Tooltip>
	);
}
