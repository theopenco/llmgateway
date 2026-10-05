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
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

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
	orgId: string;
	transactionId: string;
	transactionLabel: string;
	amount: string;
	refundableAmount: string;
	refundedAmount: string;
	refundable: boolean;
	refundIneligibleReason: string | null;
}

export function RefundPaymentDialog({
	orgId,
	transactionId,
	transactionLabel,
	amount,
	refundableAmount,
	refundedAmount,
	refundable,
	refundIneligibleReason,
}: RefundPaymentDialogProps) {
	const router = useRouter();
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [partial, setPartial] = useState(false);
	const [partialAmount, setPartialAmount] = useState(refundableAmount);
	const [reason, setReason] = useState<RefundReason>("requested_by_customer");
	const [comment, setComment] = useState("");

	const refundMutation = $api.useMutation(
		"post",
		"/admin/devpass/{orgId}/refund",
		{
			meta: { inlineError: true },
			onSuccess: () => {
				setOpen(false);
				setPartial(false);
				setPartialAmount(refundableAmount);
				setComment("");
				router.refresh();
			},
		},
	);
	const loading = refundMutation.isPending;
	const error =
		validationError ??
		(refundMutation.isError
			? apiErrorMessage(refundMutation.error, "Failed to refund payment")
			: null);

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

	const handleOpenChange = (next: boolean) => {
		if (next) {
			refundMutation.reset();
			setValidationError(null);
		}
		setOpen(next);
	};

	const handleSubmit = () => {
		let requestedAmount: number | undefined;
		if (partial) {
			requestedAmount = parseFloat(partialAmount);
			if (
				isNaN(requestedAmount) ||
				requestedAmount <= 0 ||
				requestedAmount > parseFloat(refundableAmount)
			) {
				setValidationError(
					`Amount must be between $0.01 and ${formatUsd(refundableAmount)}`,
				);
				return;
			}
		}

		setValidationError(null);
		refundMutation.mutate({
			params: { path: { orgId } },
			body: {
				transactionId,
				amount: requestedAmount,
				reason,
				comment: comment.trim() || undefined,
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
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
