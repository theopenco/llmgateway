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

interface BlockOrgButtonProps {
	orgId: string;
	orgName: string;
	disabled?: boolean;
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
	variant = "icon",
	onBlock,
}: BlockOrgButtonProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

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
			<DialogTrigger asChild>
				{variant === "full" ? (
					<Button variant="destructive" size="sm" disabled={disabled}>
						<ShieldBan className="mr-1.5 h-4 w-4" />
						Block account
					</Button>
				) : (
					<Button
						variant="ghost"
						size="icon-sm"
						className="text-destructive hover:text-destructive"
						disabled={disabled}
						title="Block account"
					>
						<ShieldBan className="h-4 w-4" />
					</Button>
				)}
			</DialogTrigger>
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
								key sharing, fraud). Re-enable via the status toggle if it was
								done by mistake.
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
