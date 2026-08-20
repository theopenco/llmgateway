"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

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

interface ActivateFlaggedAccountButtonProps {
	userId: string;
	email: string;
	organizationCount: number;
	onActivate: (userId: string) => Promise<{
		success: boolean;
		error?: string;
	}>;
}

export function ActivateFlaggedAccountButton({
	userId,
	email,
	organizationCount,
	onActivate,
}: ActivateFlaggedAccountButtonProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);

	const handleConfirm = async () => {
		setLoading(true);
		const result = await onActivate(userId);
		setLoading(false);

		if (result.success) {
			setOpen(false);
			toast.success(`${email} activated`);
			router.refresh();
		} else {
			toast.error(result.error ?? "Failed to activate account");
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!loading) {
					setOpen(next);
				}
			}}
		>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<ShieldCheck className="mr-1.5 h-4 w-4" />
					Activate
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Activate this account?</DialogTitle>
					<DialogDescription asChild>
						<div className="space-y-3 text-sm text-muted-foreground">
							<p>
								<strong>{email}</strong> was flagged because the sign-up or
								email-verification request came from an IP reported for abuse.
								Activating will:
							</p>
							<ul className="list-disc space-y-1 pl-5">
								<li>
									Unblock credit purchases and inference for{" "}
									{organizationCount === 1
										? "its organization"
										: `all ${organizationCount} of its organizations`}
									.
								</li>
								<li>
									Mark the account as reviewed so it is never auto-flagged
									again.
								</li>
							</ul>
						</div>
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button onClick={handleConfirm} disabled={loading}>
						{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Yes, activate
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
