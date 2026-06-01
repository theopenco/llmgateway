"use client";

import { Loader2, Percent } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

interface ReferralBonusDialogProps {
	orgName: string;
	enabled: boolean;
	percent: number;
	onSave: (data: {
		enabled: boolean;
		percent: number;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function ReferralBonusDialog({
	orgName,
	enabled,
	percent,
	onSave,
}: ReferralBonusDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [isEnabled, setIsEnabled] = useState(enabled);
	const [percentValue, setPercentValue] = useState(String(percent));

	const handleSubmit = async () => {
		const parsed = parseFloat(percentValue);
		const isValidPercent = !isNaN(parsed) && parsed >= 0 && parsed <= 1000;

		// Only block on an invalid percent when the bonus is being enabled;
		// disabling should always succeed regardless of the (disabled) input.
		if (isEnabled && !isValidPercent) {
			setError("Percent must be a number between 0 and 1000");
			return;
		}

		setLoading(true);
		setError(null);

		const result = await onSave({
			enabled: isEnabled,
			percent: isValidPercent ? parsed : percent,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			router.refresh();
		} else {
			setError(result.error ?? "Failed to update referral bonus");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Percent className="mr-1.5 h-4 w-4" />
					Referral Bonus
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Referral Signup Bonus</DialogTitle>
					<DialogDescription>
						When enabled, organizations referred by {orgName} receive a bonus on
						their first credit top-up.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="flex items-center justify-between gap-4">
						<div className="space-y-1">
							<Label htmlFor="referralBonusEnabled">Enable bonus</Label>
							<p className="text-xs text-muted-foreground">
								Referred users get the bonus only when signing up via this
								org&apos;s referral link.
							</p>
						</div>
						<Checkbox
							id="referralBonusEnabled"
							checked={isEnabled}
							onCheckedChange={(checked) => setIsEnabled(checked === true)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="referralBonusPercent">Bonus percent</Label>
						<div className="relative">
							<Input
								id="referralBonusPercent"
								type="number"
								min="0"
								max="1000"
								step="1"
								value={percentValue}
								onChange={(e) => setPercentValue(e.target.value)}
								placeholder="e.g. 50"
								disabled={!isEnabled}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Percentage added to the referred org&apos;s first top-up (e.g. 50
							= +50% credits).
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
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
