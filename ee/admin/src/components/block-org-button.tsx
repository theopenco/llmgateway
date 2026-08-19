"use client";

import { Loader2, ShieldBan } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

interface BlockOrgButtonProps {
	orgId: string;
	orgName: string;
	disabled?: boolean;
	/**
	 * Why the button is disabled, surfaced as its tooltip. Set when an
	 * organization still has credits so the admin sees that blocking is refused
	 * on purpose rather than broken.
	 */
	disabledReason?: string;
	variant?: "icon" | "full";
	onBlock: (orgId: string) => Promise<{
		success: boolean;
		error?: string;
		cancelledSubscriptionIds?: string[];
	}>;
}

export function BlockOrgButton({
	orgId,
	orgName,
	disabled,
	disabledReason,
	variant = "icon",
	onBlock,
}: BlockOrgButtonProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const actionTitle =
		"Block organization, deactivate every member, and cancel all subscriptions";

	const handleConfirm = async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await onBlock(orgId);
			if (result.success) {
				setOpen(false);
				router.refresh();
			} else {
				setError(result.error ?? "Failed to block organization");
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to block organization",
			);
		} finally {
			setLoading(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (loading) {
					return;
				}
				setOpen(next);
				if (!next) {
					setError(null);
				}
			}}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex">
						<DialogTrigger asChild>
							{variant === "full" ? (
								<Button
									variant="destructive"
									size="sm"
									aria-label="Block account"
									disabled={disabled}
								>
									<ShieldBan className="mr-1.5 h-4 w-4" />
									Block account
								</Button>
							) : (
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Block account"
									className="text-destructive hover:text-destructive"
									disabled={disabled}
								>
									<ShieldBan className="h-4 w-4" />
								</Button>
							)}
						</DialogTrigger>
					</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">
					{disabled ? disabledReason : actionTitle}
				</TooltipContent>
			</Tooltip>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Block this account?</DialogTitle>
					<DialogDescription asChild>
						<div className="space-y-3 text-sm text-muted-foreground">
							<p>
								You are about to block <strong>{orgName}</strong>. This will:
							</p>
							<ul className="list-disc space-y-1 pl-5">
								<li>
									Immediately cancel every active Stripe subscription on this
									organization (DevPass and any pro subscription).
								</li>
								<li>
									Mark the organization as deleted so gateway requests are
									rejected.
								</li>
								<li>
									Deactivate all members and sign them out of every session.
								</li>
							</ul>
							<p>
								This action is intended for confirmed abuse (duplicate cards,
								key sharing, fraud). Re-enabling the organization later does not
								reactivate its members or restore cancelled subscriptions.
							</p>
						</div>
					</DialogDescription>
				</DialogHeader>

				{error && (
					<p className="text-sm text-destructive" role="alert">
						{error}
					</p>
				)}

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						onClick={handleConfirm}
						disabled={loading}
					>
						{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Yes, block account
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
