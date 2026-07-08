"use client";

import { Loader2, Settings2 } from "lucide-react";
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

type Plan = "free" | "pro" | "enterprise";

interface ManageOrgDialogProps {
	orgName: string;
	plan: string;
	seats: number | null;
	onSave: (data: {
		plan: Plan;
		seats: number | null;
	}) => Promise<{ success: boolean; error?: string }>;
}

const PLAN_DEFAULT_SEATS: Record<Plan, number> = {
	free: 5,
	pro: 5,
	enterprise: 100,
};

export function ManageOrgDialog({
	orgName,
	plan,
	seats,
	onSave,
}: ManageOrgDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [planValue, setPlanValue] = useState<Plan>(
		plan === "pro" || plan === "enterprise" ? plan : "free",
	);
	const [seatsValue, setSeatsValue] = useState(
		seats === null ? "" : String(seats),
	);

	const handleSubmit = async () => {
		let seatsToSave: number | null = null;
		const trimmed = seatsValue.trim();
		if (trimmed !== "") {
			const parsed = Number(trimmed);
			if (!Number.isInteger(parsed) || parsed < 0) {
				setError("Seats must be a non-negative whole number");
				return;
			}
			seatsToSave = parsed;
		}

		setLoading(true);
		setError(null);

		const result = await onSave({ plan: planValue, seats: seatsToSave });

		setLoading(false);

		if (result.success) {
			setOpen(false);
			router.refresh();
		} else {
			setError(result.error ?? "Failed to update organization");
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<Settings2 className="mr-1.5 h-4 w-4" />
					Manage org
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Manage {orgName}</DialogTitle>
					<DialogDescription>
						Change the plan tier and override the team-member seat limit.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="managePlan">Plan tier</Label>
						<Select
							value={planValue}
							onValueChange={(v) => setPlanValue(v as Plan)}
						>
							<SelectTrigger id="managePlan">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="free">Free</SelectItem>
								<SelectItem value="pro">Pro</SelectItem>
								<SelectItem value="enterprise">Enterprise</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="manageSeats">Seat limit override</Label>
						<Input
							id="manageSeats"
							type="number"
							min="0"
							step="1"
							value={seatsValue}
							onChange={(e) => setSeatsValue(e.target.value)}
							placeholder={`Default (${PLAN_DEFAULT_SEATS[planValue]})`}
						/>
						<p className="text-xs text-muted-foreground">
							Leave empty to use the plan default (
							{PLAN_DEFAULT_SEATS[planValue]} seats). When set, this value takes
							precedence for both display and enforcement.
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
