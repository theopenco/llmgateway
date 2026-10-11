"use client";

import { Gift, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

interface GiftCreditsDialogProps {
	orgId: string;
	orgName: string;
}

export function GiftCreditsDialog({ orgId, orgName }: GiftCreditsDialogProps) {
	const router = useRouter();
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [creditAmount, setCreditAmount] = useState("");
	const [comment, setComment] = useState("");

	const giftMutation = $api.useMutation(
		"post",
		"/admin/organizations/{orgId}/gift-credits",
		{
			meta: { inlineError: true },
			onSuccess: () => {
				setOpen(false);
				setCreditAmount("");
				setComment("");
				router.refresh();
			},
		},
	);
	const loading = giftMutation.isPending;
	const error =
		validationError ??
		(giftMutation.isError
			? apiErrorMessage(giftMutation.error, "Failed to gift credits")
			: null);

	const handleOpenChange = (next: boolean) => {
		if (next) {
			giftMutation.reset();
			setValidationError(null);
		}
		setOpen(next);
	};

	const handleSubmit = () => {
		const amount = parseFloat(creditAmount);
		if (isNaN(amount) || amount <= 0) {
			setValidationError("Credit amount must be a positive number");
			return;
		}

		setValidationError(null);
		giftMutation.mutate({
			params: { path: { orgId } },
			body: {
				creditAmount: amount,
				comment: comment.trim() || undefined,
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Gift className="mr-1.5 h-4 w-4" />
					Gift Credits
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Gift Credits</DialogTitle>
					<DialogDescription>
						Gift credits to {orgName}. This creates a transaction record and
						updates the organization&apos;s credit balance.
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
							onChange={(e) => setCreditAmount(e.target.value)}
							placeholder="e.g. 50"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="comment">Comment (Optional)</Label>
						<Textarea
							id="comment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="e.g. Welcome bonus, Compensation for downtime"
							rows={3}
						/>
						<p className="text-xs text-muted-foreground">
							Stored in the transaction description
						</p>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button
						variant="outline"
						onClick={() => setOpen(false)}
						disabled={loading}
					>
						Cancel
					</Button>
					<Button onClick={handleSubmit} disabled={loading}>
						{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Gift Credits
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
