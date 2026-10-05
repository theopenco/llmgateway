"use client";

import { Banknote, Loader2 } from "lucide-react";
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
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

export type ManualPaymentMethod = "wire" | "crypto" | "paypal" | "other";

const PAYMENT_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
	wire: "Wire transfer",
	crypto: "Crypto",
	paypal: "PayPal",
	other: "Other",
};

interface ManualCreditsDialogProps {
	orgId: string;
	orgName: string;
}

export function ManualCreditsDialog({
	orgId,
	orgName,
}: ManualCreditsDialogProps) {
	const router = useRouter();
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [creditAmount, setCreditAmount] = useState("");
	const [paymentMethod, setPaymentMethod] =
		useState<ManualPaymentMethod>("wire");
	const [externalReference, setExternalReference] = useState("");
	const [comment, setComment] = useState("");

	const creditMutation = $api.useMutation(
		"post",
		"/admin/organizations/{orgId}/manual-credits",
		{
			meta: { inlineError: true },
			onSuccess: () => {
				setOpen(false);
				setCreditAmount("");
				setPaymentMethod("wire");
				setExternalReference("");
				setComment("");
				router.refresh();
			},
		},
	);
	const loading = creditMutation.isPending;
	const error =
		validationError ??
		(creditMutation.isError
			? apiErrorMessage(creditMutation.error, "Failed to add credits")
			: null);

	const handleOpenChange = (next: boolean) => {
		if (next) {
			creditMutation.reset();
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
		creditMutation.mutate({
			params: { path: { orgId } },
			body: {
				creditAmount: amount,
				paymentMethod,
				externalReference: externalReference.trim() || undefined,
				comment: comment.trim() || undefined,
			},
		});
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Banknote className="mr-1.5 h-4 w-4" />
					Add Paid Credits
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Add Paid Credits</DialogTitle>
					<DialogDescription>
						Credit {orgName} for a payment received outside Stripe (wire,
						crypto, …). Unlike a gift this counts as revenue, so only use it
						when the money actually arrived.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="manualCreditAmount">Amount Paid (USD)</Label>
						<Input
							id="manualCreditAmount"
							type="number"
							min="0.01"
							step="0.01"
							value={creditAmount}
							onChange={(e) => setCreditAmount(e.target.value)}
							placeholder="e.g. 500"
						/>
						<p className="text-xs text-muted-foreground">
							Booked as both the payment received and the credits granted
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="manualPaymentMethod">Payment Method</Label>
						<Select
							value={paymentMethod}
							onValueChange={(value) =>
								setPaymentMethod(value as ManualPaymentMethod)
							}
						>
							<SelectTrigger id="manualPaymentMethod" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(
									Object.keys(PAYMENT_METHOD_LABELS) as ManualPaymentMethod[]
								).map((method) => (
									<SelectItem key={method} value={method}>
										{PAYMENT_METHOD_LABELS[method]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="manualExternalReference">
							Transaction ID / Reference (Optional)
						</Label>
						<Input
							id="manualExternalReference"
							value={externalReference}
							onChange={(e) => setExternalReference(e.target.value)}
							placeholder="e.g. bank reference, tx hash, PayPal id"
							maxLength={255}
						/>
						<p className="text-xs text-muted-foreground">
							Identifier for the payment on its own channel, kept as a separate
							field for reconciliation
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="manualComment">Comment (Optional)</Label>
						<Textarea
							id="manualComment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="e.g. Invoice INV-1042, USDC tx 0xabc…"
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
						Add Credits
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
