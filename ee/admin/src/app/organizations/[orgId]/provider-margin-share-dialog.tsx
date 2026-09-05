"use client";

import { Loader2, Percent } from "lucide-react";
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
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

interface ProviderMarginShareDialogProps {
	orgId: string;
	orgName: string;
	percent: number;
	accrued: string;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 6,
});

export function ProviderMarginShareDialog({
	orgId,
	orgName,
	percent,
	accrued,
}: ProviderMarginShareDialogProps) {
	const router = useRouter();
	const $api = useApi();
	const [open, setOpen] = useState(false);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [percentValue, setPercentValue] = useState(String(percent));

	const saveMutation = $api.useMutation(
		"patch",
		"/admin/organizations/{orgId}/margin-share",
		{
			meta: { inlineError: true },
			onSuccess: () => {
				setOpen(false);
				router.refresh();
			},
		},
	);
	const loading = saveMutation.isPending;
	const error =
		validationError ??
		(saveMutation.isError
			? apiErrorMessage(
					saveMutation.error,
					"Failed to update provider margin share",
				)
			: null);

	// Start every open from the saved value so a cancelled edit is never
	// submitted later.
	const handleOpenChange = (next: boolean) => {
		if (next) {
			saveMutation.reset();
			setValidationError(null);
			setPercentValue(String(percent));
		}
		setOpen(next);
	};

	const handleSubmit = () => {
		const parsed = parseFloat(percentValue);
		if (isNaN(parsed) || parsed < 0 || parsed > 100) {
			setValidationError("Percent must be a number between 0 and 100");
			return;
		}

		setValidationError(null);
		saveMutation.mutate({
			params: { path: { orgId } },
			body: { percent: parsed },
		});
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Percent className="mr-1.5 h-4 w-4" />
					Margin Share
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Provider Margin Share</DialogTitle>
					<DialogDescription>
						Share of the Airside carrier margin earned on {orgName}&apos;s
						traffic that is passed to the organization. It accrues to the
						organization&apos;s end-user margin balance and is paid out through
						Stripe Connect. Not visible to the organization&apos;s members.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="providerMarginSharePercent">Share percent</Label>
						<Input
							id="providerMarginSharePercent"
							type="number"
							min="0"
							max="100"
							step="1"
							value={percentValue}
							onChange={(e) => setPercentValue(e.target.value)}
							placeholder="e.g. 50"
						/>
						<p className="text-xs text-muted-foreground">
							Percentage of the carrier margin (e.g. 50 = half of a 20% margin,
							so 10% of provider cost). 0 disables the share.
						</p>
					</div>

					<p className="text-xs text-muted-foreground">
						Accrued to date: {currencyFormatter.format(Number(accrued))}
					</p>

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
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
