"use client";

import { Gift } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Textarea } from "@/lib/components/textarea";
import { useToast } from "@/lib/components/use-toast";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";
import Spinner from "@/lib/icons/Spinner";

import type React from "react";

export function GiftCreditsButton() {
	return (
		<GiftCreditsDialog>
			<Button variant="outline" className="flex items-center">
				<Gift className="mr-2 h-4 w-4" />
				Gift Credits
			</Button>
		</GiftCreditsDialog>
	);
}

interface GiftCreditsDialogProps {
	children: React.ReactNode;
}

export function GiftCreditsDialog({ children }: GiftCreditsDialogProps) {
	const [open, setOpen] = useState(false);
	const [creditAmount, setCreditAmount] = useState<number>(10);
	const [comment, setComment] = useState<string>("");
	const { toast } = useToast();
	const api = useApi();
	const { selectedOrganization } = useDashboardState();

	const { mutateAsync: giftCreditsMutation, isPending: isGifting } =
		api.useMutation("post", "/orgs/{id}/gift-credits");

	const handleGiftCredits = async () => {
		if (!selectedOrganization) {
			toast({
				title: "Error",
				description: "No organization selected",
				variant: "destructive",
			});
			return;
		}

		if (creditAmount <= 0) {
			toast({
				title: "Error",
				description: "Credit amount must be positive",
				variant: "destructive",
			});
			return;
		}

		try {
			await giftCreditsMutation({
				params: {
					path: {
						id: selectedOrganization.id,
					},
				},
				body: {
					creditAmount,
					comment: comment.trim() || undefined,
				},
			});

			toast({
				title: "Success",
				description: `Successfully gifted ${creditAmount} credits to ${selectedOrganization.name}`,
			});

			// Close dialog and reset
			setOpen(false);
			setCreditAmount(10);
			setComment("");

			// Refresh the page to update credits
			window.location.reload();
		} catch (error) {
			toast({
				title: "Error",
				description:
					error instanceof Error ? error.message : "Failed to gift credits",
				variant: "destructive",
			});
		}
	};

	const handleClose = () => {
		setOpen(false);
		setCreditAmount(10);
		setComment("");
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Gift Credits</DialogTitle>
					<DialogDescription>
						Gift credits to {selectedOrganization?.name ?? "this organization"}.
						This will create a transaction record and update the
						organization&apos;s credit balance.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="creditAmount">Credit Amount</Label>
						<Input
							id="creditAmount"
							type="number"
							min="0.01"
							step="0.01"
							value={creditAmount}
							onChange={(e) => setCreditAmount(parseFloat(e.target.value))}
							placeholder="Enter amount of credits to gift"
						/>
						<p className="text-sm text-muted-foreground">
							The amount of credits to add to the organization
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="comment">Comment (Optional)</Label>
						<Textarea
							id="comment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="E.g., Welcome bonus, Compensation for downtime, etc."
							rows={3}
						/>
						<p className="text-sm text-muted-foreground">
							This comment will be visible in the transaction history
						</p>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={handleClose} disabled={isGifting}>
						Cancel
					</Button>
					<Button onClick={handleGiftCredits} disabled={isGifting}>
						{isGifting && <Spinner className="mr-2 h-4 w-4" />}
						Gift Credits
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
