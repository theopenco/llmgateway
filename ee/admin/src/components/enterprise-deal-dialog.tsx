"use client";

import { Handshake, Loader2, Pencil } from "lucide-react";
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

interface EnterpriseDeal {
	id: string;
	createdAt: string;
	amount: string | null;
	paymentMethod: string | null;
	externalReference: string | null;
	description: string | null;
}

type EnterprisePaymentMethod = "wire" | "crypto" | "other";

const PAYMENT_METHOD_LABELS: Record<EnterprisePaymentMethod, string> = {
	wire: "Wire transfer",
	crypto: "Crypto",
	other: "Other",
};

interface EnterpriseDealDialogProps {
	orgId: string;
	orgName: string;
	deal?: EnterpriseDeal;
}

function toPaymentMethod(
	value: string | null | undefined,
): EnterprisePaymentMethod {
	return value && value in PAYMENT_METHOD_LABELS
		? (value as EnterprisePaymentMethod)
		: "wire";
}

export function EnterpriseDealDialog({
	orgId,
	orgName,
	deal,
}: EnterpriseDealDialogProps) {
	const router = useRouter();
	const $api = useApi();
	const editing = Boolean(deal);
	const [open, setOpen] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [amount, setAmount] = useState(deal?.amount ?? "");
	const [paymentMethod, setPaymentMethod] = useState<EnterprisePaymentMethod>(
		toPaymentMethod(deal?.paymentMethod),
	);
	const [transactionDate, setTransactionDate] = useState(
		deal?.createdAt.slice(0, 10) ?? "",
	);
	const [externalReference, setExternalReference] = useState(
		deal?.externalReference ?? "",
	);
	const [comment, setComment] = useState(deal?.description ?? "");

	const onSuccess = () => {
		setOpen(false);
		if (!editing) {
			setAmount("");
			setPaymentMethod("wire");
			setTransactionDate("");
			setExternalReference("");
			setComment("");
		}
		router.refresh();
	};
	const addMutation = $api.useMutation(
		"post",
		"/admin/organizations/{orgId}/enterprise-deals",
		{ meta: { inlineError: true }, onSuccess },
	);
	const updateMutation = $api.useMutation(
		"patch",
		"/admin/organizations/{orgId}/enterprise-deals/{transactionId}",
		{ meta: { inlineError: true }, onSuccess },
	);
	const mutation = editing ? updateMutation : addMutation;
	const loading = mutation.isPending;
	const error =
		validationError ??
		(mutation.isError
			? apiErrorMessage(mutation.error, "Failed to save enterprise deal")
			: null);

	const handleOpenChange = (next: boolean) => {
		if (next) {
			mutation.reset();
			setValidationError(null);
		}
		setOpen(next);
	};

	const handleSubmit = () => {
		const parsedAmount = parseFloat(amount);
		if (isNaN(parsedAmount) || parsedAmount <= 0) {
			setValidationError("Deal amount must be a positive number");
			return;
		}

		setValidationError(null);
		const body = {
			amount: parsedAmount,
			paymentMethod,
			transactionDate: transactionDate || undefined,
			externalReference: externalReference.trim() || undefined,
			comment: comment.trim() || undefined,
		};
		if (deal) {
			updateMutation.mutate({
				params: { path: { orgId, transactionId: deal.id } },
				body,
			});
		} else {
			addMutation.mutate({ params: { path: { orgId } }, body });
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				{editing ? (
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label="Edit enterprise deal"
						title="Edit enterprise deal"
					>
						<Pencil className="h-3.5 w-3.5" />
					</Button>
				) : (
					<Button variant="outline" size="sm">
						<Handshake className="mr-1.5 h-4 w-4" />
						Add Enterprise Deal
					</Button>
				)}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{editing ? "Edit Enterprise Deal" : "Add Enterprise Deal"}
					</DialogTitle>
					<DialogDescription>
						Record contract revenue for {orgName}. It counts toward total gross
						revenue without adding credits to the organization.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor={`enterpriseDealAmount-${deal?.id ?? "new"}`}>
							Amount Paid (USD)
						</Label>
						<Input
							id={`enterpriseDealAmount-${deal?.id ?? "new"}`}
							type="number"
							min="0.01"
							step="0.01"
							value={amount}
							onChange={(event) => setAmount(event.target.value)}
							placeholder="e.g. 5000"
						/>
						<p className="text-xs text-muted-foreground">
							Booked as revenue only; no credits are granted
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`enterpriseDate-${deal?.id ?? "new"}`}>
							Transaction Date (Optional)
						</Label>
						<Input
							id={`enterpriseDate-${deal?.id ?? "new"}`}
							type="date"
							value={transactionDate}
							onChange={(event) => setTransactionDate(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							Leave empty to use the current date
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`enterprisePaymentMethod-${deal?.id ?? "new"}`}>
							Payment Method
						</Label>
						<Select
							value={paymentMethod}
							onValueChange={(value) =>
								setPaymentMethod(value as EnterprisePaymentMethod)
							}
						>
							<SelectTrigger
								id={`enterprisePaymentMethod-${deal?.id ?? "new"}`}
								className="w-full"
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{(
									Object.keys(
										PAYMENT_METHOD_LABELS,
									) as EnterprisePaymentMethod[]
								).map((method) => (
									<SelectItem key={method} value={method}>
										{PAYMENT_METHOD_LABELS[method]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`enterpriseReference-${deal?.id ?? "new"}`}>
							Transaction ID / Reference (Optional)
						</Label>
						<Input
							id={`enterpriseReference-${deal?.id ?? "new"}`}
							value={externalReference}
							onChange={(event) => setExternalReference(event.target.value)}
							placeholder="e.g. invoice or bank reference"
							maxLength={255}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor={`enterpriseComment-${deal?.id ?? "new"}`}>
							Comment (Optional)
						</Label>
						<Textarea
							id={`enterpriseComment-${deal?.id ?? "new"}`}
							value={comment}
							onChange={(event) => setComment(event.target.value)}
							placeholder="e.g. Annual platform agreement"
							maxLength={2000}
							rows={3}
						/>
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
						{editing ? "Save Changes" : "Add Deal"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
