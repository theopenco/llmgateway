"use client";

import { Ban, CircleCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface OrgStatusToggleButtonProps {
	orgId: string;
	orgName: string;
	currentStatus: "active" | "deleted" | string | null | undefined;
	onToggle: (
		orgId: string,
		status: "active" | "deleted",
	) => Promise<{ success: boolean; error?: string }>;
}

export function OrgStatusToggleButton({
	orgId,
	orgName,
	currentStatus,
	onToggle,
}: OrgStatusToggleButtonProps) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const isDisabled = currentStatus === "deleted";
	const nextStatus: "active" | "deleted" = isDisabled ? "active" : "deleted";

	const handleClick = async () => {
		const verb = isDisabled ? "re-enable" : "disable";
		if (
			!confirm(
				`Are you sure you want to ${verb} organization "${orgName}"? ${
					isDisabled
						? "Members will be reactivated (unless they belong to another disabled organization) and gateway requests will resume."
						: "All members will be deactivated and signed out, and gateway requests will be rejected with HTTP 410."
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
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={handleClick}
			disabled={loading}
			className={
				isDisabled
					? "text-emerald-600 hover:text-emerald-600"
					: "text-amber-600 hover:text-amber-600"
			}
			title={isDisabled ? "Re-enable organization" : "Disable organization"}
		>
			{loading ? (
				<Loader2 className="h-4 w-4 animate-spin" />
			) : isDisabled ? (
				<CircleCheck className="h-4 w-4" />
			) : (
				<Ban className="h-4 w-4" />
			)}
		</Button>
	);
}
