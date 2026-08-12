"use client";

import { Loader2, Undo2 } from "lucide-react";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";

type RefundReason = "requested_by_customer" | "duplicate" | "fraudulent";

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 2,
});

function formatUsd(amount: string) {
	return currencyFormatter.format(parseFloat(amount));
}

const REFUND_INELIGIBLE_LABELS: Record<string, string> = {
	not_completed: "Payment never completed",
	no_payment: "No Stripe payment recorded on this row",
	fully_refunded: "Already fully refunded",
};

interface RefundPaymentDialogProps {
	transactionId: string;
	transactionLabel: string;
	amount: string;
	refundableAmount: string;
	refundedAmount: string;
	refundable: boolean;
	refundIneligibleReason: string | null;
	onRefund: (data: {
		transactionId: string;
		amount?: number;
		reason: RefundReason;
		comment?: string;
	}) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export function RefundPaymentDialog({
	transactionId,
	transactionLabel,
	amount,
	refundableAmount,
	refundedAmount,
	refundable,
	refundIneligibleReason,
	onRefund,
}: RefundPaymentDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [partial, setPartial] = useState(false);
	const [partialAmount, setPartialAmount] = useState(refundableAmount);
	const [reason, setReason] = useState<RefundReason>("requested_by_customer");
	const [comment, setComment] = useState("");

	if (!refundable) {
		const label = refundIneligibleReason
			? REFUND_INELIGIBLE_LABELS[refundIneligibleReason]
			: undefined;
		// An unrefundable *type* (a cancel/end bookkeeping row) gets no control at
		// all; a real payment that merely failed a check gets a disabled one that
		// says why.
		if (!label) {
			return null;
		}
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<span>
						<Button variant="ghost" size="sm" disabled>
							<Undo2 className="mr-1.5 h-4 w-4" />
							Refund
						</Button>
					</span>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
		);
	}

	const handleSubmit = async () => {
		let requestedAmount: number | undefined;
		if (partial) {
			requestedAmount = parseFloat(partialAmount);
			if (
				isNaN(requestedAmount) ||
				requestedAmount <= 0 ||
				requestedAmount > parseFloat(refundableAmount)
			) {
				setError(
					`Amount must be between $0.01 and ${formatUsd(refundableAmount)}`,
				);
				return;
			}
		}

		setLoading(true);
		setError(null);

		const result = await onRefund({
			transactionId,
			amount: requestedAmount,
			reason,
			comment: comment.trim() || undefined,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setPartial(false);
			setPartialAmount(refundableAmount);
			setComment("");
			router.refresh();
		} else {
			setError(result.error ?? "Failed to refund payment");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="sm">
					<Undo2 className="mr-1.5 h-4 w-4" />
					Refund
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Refund payment</DialogTitle>
					<DialogDescription>
						Refund {transactionLabel} of {formatUsd(amount)} on behalf of the
						subscriber. Credits, Reset Passes and plan status are updated once
						Stripe confirms the refund — a full refund of a plan payment also
						cancels the DevPass subscription.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{parseFloat(refundedAmount) > 0 && (
						<p className="text-sm text-muted-foreground">
							{formatUsd(refundedAmount)} of {formatUsd(amount)} has already
							been refunded. {formatUsd(refundableAmount)} is still refundable.
						</p>
					)}

					<div className="space-y-2">
						<Label htmlFor="amount">Amount</Label>
						<div className="flex items-center gap-2">
							<Button
								type="button"
								variant={partial ? "outline" : "default"}
								size="sm"
								onClick={() => setPartial(false)}
							>
								Full ({formatUsd(refundableAmount)})
							</Button>
							<Button
								type="button"
								variant={partial ? "default" : "outline"}
								size="sm"
								onClick={() => setPartial(true)}
							>
								Partial
							</Button>
						</div>
						{partial && (
							<Input
								id="amount"
								type="number"
								min="0.01"
								max={refundableAmount}
								step="0.01"
								value={partialAmount}
								onChange={(e) => setPartialAmount(e.target.value)}
							/>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="reason">Reason</Label>
						<Select
							value={reason}
							onValueChange={(v) => setReason(v as RefundReason)}
						>
							<SelectTrigger id="reason">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="requested_by_customer">
									Requested by customer
								</SelectItem>
								<SelectItem value="duplicate">Duplicate</SelectItem>
								<SelectItem value="fraudulent">Fraudulent</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Sent to Stripe as the refund reason
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="comment">Comment (Optional)</Label>
						<Textarea
							id="comment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="e.g. Goodwill refund after a provider outage"
							rows={3}
						/>
						<p className="text-xs text-muted-foreground">
							Stored in the audit log
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
					<Button
						variant="destructive"
						onClick={handleSubmit}
						disabled={loading}
					>
						{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						Refund payment
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
