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

export type ManualPaymentMethod = "wire" | "crypto" | "paypal" | "other";

const PAYMENT_METHOD_LABELS: Record<ManualPaymentMethod, string> = {
	wire: "Wire transfer",
	crypto: "Crypto",
	paypal: "PayPal",
	other: "Other",
};

interface ManualCreditsDialogProps {
	orgName: string;
	onCredit: (data: {
		creditAmount: number;
		paymentMethod: ManualPaymentMethod;
		externalReference?: string;
		comment?: string;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function ManualCreditsDialog({
	orgName,
	onCredit,
}: ManualCreditsDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [creditAmount, setCreditAmount] = useState("");
	const [paymentMethod, setPaymentMethod] =
		useState<ManualPaymentMethod>("wire");
	const [externalReference, setExternalReference] = useState("");
	const [comment, setComment] = useState("");

	const handleSubmit = async () => {
		const amount = parseFloat(creditAmount);
		if (isNaN(amount) || amount <= 0) {
			setError("Credit amount must be a positive number");
			return;
		}

		setLoading(true);
		setError(null);

		const result = await onCredit({
			creditAmount: amount,
			paymentMethod,
			externalReference: externalReference.trim() || undefined,
			comment: comment.trim() || undefined,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setCreditAmount("");
			setPaymentMethod("wire");
			setExternalReference("");
			setComment("");
			router.refresh();
		} else {
			setError(result.error ?? "Failed to add credits");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
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
