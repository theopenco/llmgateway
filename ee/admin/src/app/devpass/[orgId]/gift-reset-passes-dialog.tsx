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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Tier = "lite" | "pro" | "max";

interface GiftResetPassesDialogProps {
	orgName: string;
	defaultTier: Tier;
	onGift: (data: {
		tier: Tier;
		count: number;
		comment?: string;
	}) => Promise<{ success: boolean; error?: string }>;
}

export function GiftResetPassesDialog({
	orgName,
	defaultTier,
	onGift,
}: GiftResetPassesDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [tier, setTier] = useState<Tier>(defaultTier);
	const [count, setCount] = useState("1");
	const [comment, setComment] = useState("");

	const handleSubmit = async () => {
		const parsedCount = Number(count);
		if (!Number.isInteger(parsedCount) || parsedCount < 1 || parsedCount > 10) {
			setError("Count must be a whole number between 1 and 10");
			return;
		}

		setLoading(true);
		setError(null);

		const result = await onGift({
			tier,
			count: parsedCount,
			comment: comment.trim() || undefined,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setTier(defaultTier);
			setCount("1");
			setComment("");
			router.refresh();
		} else {
			setError(result.error ?? "Failed to gift Reset Passes");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Gift className="mr-1.5 h-4 w-4" />
					Gift Reset Passes
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Gift Reset Passes</DialogTitle>
					<DialogDescription>
						Gift Reset Passes to {orgName}. Passes are tier-bound: they are
						redeemable only while the subscriber is on the selected tier, and
						they survive plan changes.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="tier">Tier</Label>
						<Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
							<SelectTrigger id="tier">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="lite">Lite</SelectItem>
								<SelectItem value="pro">Pro</SelectItem>
								<SelectItem value="max">Max</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="count">Count</Label>
						<Input
							id="count"
							type="number"
							min="1"
							max="10"
							step="1"
							value={count}
							onChange={(e) => setCount(e.target.value)}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="comment">Comment (Optional)</Label>
						<Textarea
							id="comment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="e.g. Compensation for premium-model outage"
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
						Gift Reset Passes
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
