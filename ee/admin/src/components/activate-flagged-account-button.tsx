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
import { useApi } from "@/lib/fetch-client";

interface ActivateFlaggedAccountButtonProps {
	userId: string;
	email: string;
	organizationCount: number;
}

export function ActivateFlaggedAccountButton({
	userId,
	email,
	organizationCount,
}: ActivateFlaggedAccountButtonProps) {
	const router = useRouter();
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const mutation = $api.useMutation(
		"post",
		"/admin/flagged-accounts/{userId}/approve",
		{
			meta: { errorMessage: "Failed to activate account" },
			onSuccess: () => {
				setOpen(false);
				toast.success(`${email} activated`);
				router.refresh();
			},
		},
	);
	const loading = mutation.isPending;

	const handleConfirm = () => {
		mutation.mutate({ params: { path: { userId } } });
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
