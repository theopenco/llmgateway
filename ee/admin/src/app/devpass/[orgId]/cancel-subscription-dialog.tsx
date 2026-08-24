"use client";

import { Ban, Loader2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface CancelSubscriptionDialogProps {
	orgName: string;
	tier: string;
	expiresAt: string | null;
	alreadyCancelled: boolean;
	onCancel: (data: {
		immediate: boolean;
		comment?: string;
	}) => Promise<{ success: boolean; message?: string; error?: string }>;
}

export function CancelSubscriptionDialog({
	orgName,
	tier,
	expiresAt,
	alreadyCancelled,
	onCancel,
}: CancelSubscriptionDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [timing, setTiming] = useState<"period_end" | "immediate">(
		"period_end",
	);
	const [comment, setComment] = useState("");

	const handleSubmit = async () => {
		setLoading(true);
		setError(null);

		const result = await onCancel({
			immediate: timing === "immediate",
			comment: comment.trim() || undefined,
		});

		setLoading(false);

		if (result.success) {
			setOpen(false);
			setComment("");
			router.refresh();
		} else {
			setError(result.error ?? "Failed to cancel subscription");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Ban className="mr-1.5 h-4 w-4" />
					Cancel subscription
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Cancel DevPass subscription</DialogTitle>
					<DialogDescription>
						Cancel the {tier} subscription of {orgName} on behalf of the
						subscriber. Cancelling does not refund anything — refund the latest
						payment separately if the customer should get their money back.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{alreadyCancelled && (
						<p className="text-sm text-amber-600">
							This subscription is already set to end
							{expiresAt
								? ` on ${new Date(expiresAt).toLocaleDateString("en-US")}`
								: ""}
							. Cancelling immediately ends access right away.
						</p>
					)}

					<div className="space-y-2">
						<Label htmlFor="timing">When</Label>
						<Select
							value={timing}
							onValueChange={(v) => setTiming(v as "period_end" | "immediate")}
						>
							<SelectTrigger id="timing">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="period_end">
									At the end of the paid period
								</SelectItem>
								<SelectItem value="immediate">Immediately</SelectItem>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{timing === "period_end"
								? expiresAt
									? `Access continues until ${new Date(expiresAt).toLocaleDateString("en-US")}, then the plan ends.`
									: "Access continues until the current period ends."
								: "Access ends now. No proration invoice is created."}
						</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="comment">Comment (Optional)</Label>
						<Textarea
							id="comment"
							value={comment}
							onChange={(e) => setComment(e.target.value)}
							placeholder="e.g. Cancelled on request via support"
							rows={3}
						/>
						<p className="text-xs text-muted-foreground">
							Stored in the audit log and sent to Stripe as the cancellation
							comment
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
						Back
					</Button>
					<Button
						variant="destructive"
						onClick={handleSubmit}
						disabled={loading}
					>
						{loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
						{timing === "immediate"
							? "Cancel immediately"
							: "Cancel at period end"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
