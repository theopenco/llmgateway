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
	apiKeyLimit: number | null;
	onSave: (data: {
		name: string;
		plan: Plan;
		seats: number | null;
		apiKeyLimit: number | null;
	}) => Promise<{ success: boolean; error?: string }>;
}

const PLAN_DEFAULT_SEATS: Record<Plan, number> = {
	free: 5,
	pro: 5,
	enterprise: 100,
};

const PLAN_DEFAULT_API_KEYS: Record<Plan, number> = {
	free: 5,
	pro: 20,
	enterprise: 500,
};

export function ManageOrgDialog({
	orgName,
	plan,
	seats,
	apiKeyLimit,
	onSave,
}: ManageOrgDialogProps) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [nameValue, setNameValue] = useState(orgName);
	const [planValue, setPlanValue] = useState<Plan>(
		plan === "pro" || plan === "enterprise" ? plan : "free",
	);
	const [seatsValue, setSeatsValue] = useState(
		seats === null ? "" : String(seats),
	);
	const [apiKeyLimitValue, setApiKeyLimitValue] = useState(
		apiKeyLimit === null ? "" : String(apiKeyLimit),
	);

	const handleSubmit = async () => {
		const trimmedName = nameValue.trim();
		if (trimmedName === "") {
			setError("Organization name is required");
			return;
		}

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

		let apiKeyLimitToSave: number | null = null;
		const trimmedApiKeyLimit = apiKeyLimitValue.trim();
		if (trimmedApiKeyLimit !== "") {
			const parsed = Number(trimmedApiKeyLimit);
			if (!Number.isInteger(parsed) || parsed < 0) {
				setError("API key limit must be a non-negative whole number");
				return;
			}
			apiKeyLimitToSave = parsed;
		}

		setLoading(true);
		setError(null);

		const result = await onSave({
			name: trimmedName,
			plan: planValue,
			seats: seatsToSave,
			apiKeyLimit: apiKeyLimitToSave,
		});

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
						Change the plan tier and override the team-member seat limit and
						API-key limit.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="manageName">Organization name</Label>
						<Input
							id="manageName"
							value={nameValue}
							onChange={(e) => setNameValue(e.target.value)}
							placeholder="Organization name"
							maxLength={255}
						/>
					</div>

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

					<div className="space-y-2">
						<Label htmlFor="manageApiKeyLimit">API key limit override</Label>
						<Input
							id="manageApiKeyLimit"
							type="number"
							min="0"
							step="1"
							value={apiKeyLimitValue}
							onChange={(e) => setApiKeyLimitValue(e.target.value)}
							placeholder={`Default (${PLAN_DEFAULT_API_KEYS[planValue]})`}
						/>
						<p className="text-xs text-muted-foreground">
							Leave empty to use the plan default (
							{PLAN_DEFAULT_API_KEYS[planValue]} active API keys per
							organization). When set, this value takes precedence for both
							display and enforcement.
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
