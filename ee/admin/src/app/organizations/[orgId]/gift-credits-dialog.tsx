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

interface GiftCreditsDialogProps {
	orgId: string;
	orgName: string;
	onGift: (data: {
		creditAmount: number;
		comment?: string;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function GiftCreditsDialog({
	orgId,
	orgName,
	onGift,
}: GiftCreditsDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [creditAmount, setCreditAmount] = useState("");
	const [comment, setComment] = useState("");

	const handleSubmit = async () => {
		const amount = parseFloat(creditAmount);
		if (isNaN(amount) || amount <= 0) {
			setError("Credit amount must be a positive number");
			return;
		}

		setLoading(true);
		setError(null);

		const result = await onGift({
			creditAmount: amount,
			comment: comment.trim() || undefined,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setCreditAmount("");
			setComment("");
			router.refresh();
		} else {
			setError(result.error ?? "Failed to gift credits");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
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
