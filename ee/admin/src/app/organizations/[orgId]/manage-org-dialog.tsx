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
import { Switch } from "@/components/ui/switch";

import {
	ENTERPRISE_TRIAL_DAYS,
	formatPlanTermLabel,
	getOrganizationTerm,
	getPlanTerm,
} from "@llmgateway/shared";

type Plan = "free" | "pro" | "enterprise";

interface ManageOrgDialogProps {
	orgName: string;
	plan: string;
	seats: number | null;
	apiKeyLimit: number | null;
	planExpiresAt: string | null;
	planStartedAt: string | null;
	isTrialActive: boolean;
	trialStartDate: string | null;
	trialEndDate: string | null;
	onSave: (data: {
		name: string;
		plan: Plan;
		seats: number | null;
		apiKeyLimit: number | null;
		planExpiresAt: string | null;
		planStartedAt: string | null;
		isTrialActive: boolean;
		trialStartDate: string | null;
		trialEndDate: string | null;
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

// Contract lengths we actually sell, offered as one-click presets so booking a
// renewal does not turn into date arithmetic in the admin's head.
const TERM_PRESETS: { label: string; months: number }[] = [
	{ label: "3 months", months: 3 },
	{ label: "6 months", months: 6 },
	{ label: "1 year", months: 12 },
	{ label: "2 years", months: 24 },
];

/** Timestamps arrive as ISO strings; `<input type="date">` wants YYYY-MM-DD. */
function toDateInputValue(value: string | null): string {
	return value ? value.slice(0, 10) : "";
}

function todayInputValue(): string {
	return new Date().toISOString().slice(0, 10);
}

/** Adds whole days in UTC to a YYYY-MM-DD input value. */
function addDays(dateInput: string, days: number): string {
	const [year, month, day] = dateInput.split("-").map(Number);
	const target = new Date(Date.UTC(year, month - 1, day + days));
	return target.toISOString().slice(0, 10);
}

/** Adds whole months in UTC, clamping to the last day of a shorter month. */
function addMonths(dateInput: string, months: number): string {
	const [year, month, day] = dateInput.split("-").map(Number);
	const target = new Date(Date.UTC(year, month - 1 + months, 1));
	const daysInTargetMonth = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
	).getUTCDate();
	target.setUTCDate(Math.min(day, daysInTargetMonth));
	return target.toISOString().slice(0, 10);
}

export function ManageOrgDialog({
	orgName,
	plan,
	seats,
	apiKeyLimit,
	planExpiresAt,
	planStartedAt,
	isTrialActive,
	trialStartDate,
	trialEndDate,
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
	const [startedAtValue, setStartedAtValue] = useState(
		toDateInputValue(planStartedAt),
	);
	const [expiresAtValue, setExpiresAtValue] = useState(
		toDateInputValue(planExpiresAt),
	);

	const [trialActiveValue, setTrialActiveValue] = useState(isTrialActive);
	const [trialStartValue, setTrialStartValue] = useState(
		toDateInputValue(trialStartDate),
	);
	const [trialEndValue, setTrialEndValue] = useState(
		toDateInputValue(trialEndDate),
	);

	const previewTerm = getPlanTerm({
		expiresAt: expiresAtValue || null,
		startedAt: startedAtValue || null,
	});

	// Mirrors what the customer will see: an active trial wins over the contract.
	const previewLive = getOrganizationTerm({
		isTrialActive: trialActiveValue,
		trialStartDate: trialStartValue || null,
		trialEndDate: trialEndValue || null,
		planStartedAt: startedAtValue || null,
		planExpiresAt: expiresAtValue || null,
	});

	const startTrial = () => {
		const start = todayInputValue();
		setTrialActiveValue(true);
		setTrialStartValue(start);
		setTrialEndValue(addDays(start, ENTERPRISE_TRIAL_DAYS));
	};

	// A preset books a fresh term starting today rather than extending from the
	// existing start date — otherwise clicking "1 year" on a contract that began
	// a year ago would recompute the same expiry and appear to do nothing.
	const applyPreset = (months: number) => {
		const start = todayInputValue();
		setStartedAtValue(start);
		setExpiresAtValue(addMonths(start, months));
	};

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

		if (startedAtValue !== "" && expiresAtValue === "") {
			setError("A plan start date needs an expiry date too");
			return;
		}

		if (
			startedAtValue !== "" &&
			expiresAtValue !== "" &&
			startedAtValue >= expiresAtValue
		) {
			setError("Plan start date must be before the expiry date");
			return;
		}

		if (trialActiveValue && trialEndValue === "") {
			setError("An active trial needs an end date");
			return;
		}

		if (
			trialStartValue !== "" &&
			trialEndValue !== "" &&
			trialStartValue >= trialEndValue
		) {
			setError("Trial start date must be before the trial end date");
			return;
		}

		setLoading(true);
		setError(null);

		const result = await onSave({
			name: trimmedName,
			plan: planValue,
			seats: seatsToSave,
			apiKeyLimit: apiKeyLimitToSave,
			planStartedAt: startedAtValue === "" ? null : startedAtValue,
			planExpiresAt: expiresAtValue === "" ? null : expiresAtValue,
			isTrialActive: trialActiveValue,
			trialStartDate: trialStartValue === "" ? null : trialStartValue,
			trialEndDate: trialEndValue === "" ? null : trialEndValue,
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
						Change the plan tier, set the plan term, and override the
						team-member seat limit and API-key limit.
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

					<div className="space-y-3 rounded-lg border p-3">
						<div className="flex items-center justify-between gap-2">
							<Label>Plan term</Label>
							{previewTerm ? (
								<span className="text-muted-foreground text-xs tabular-nums">
									{formatPlanTermLabel(previewTerm)}
									{previewTerm.totalDays !== null
										? ` · ${previewTerm.totalDays}-day term`
										: ""}
								</span>
							) : (
								<span className="text-muted-foreground text-xs">
									No end date
								</span>
							)}
						</div>

						<div className="grid grid-cols-2 gap-3">
							<div className="space-y-1.5">
								<Label
									htmlFor="managePlanStartedAt"
									className="text-muted-foreground text-xs font-normal"
								>
									Starts
								</Label>
								<Input
									id="managePlanStartedAt"
									type="date"
									value={startedAtValue}
									onChange={(e) => setStartedAtValue(e.target.value)}
								/>
							</div>
							<div className="space-y-1.5">
								<Label
									htmlFor="managePlanExpiresAt"
									className="text-muted-foreground text-xs font-normal"
								>
									Expires
								</Label>
								<Input
									id="managePlanExpiresAt"
									type="date"
									value={expiresAtValue}
									onChange={(e) => setExpiresAtValue(e.target.value)}
								/>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-1.5">
							{TERM_PRESETS.map((preset) => (
								<Button
									key={preset.months}
									type="button"
									variant="outline"
									size="sm"
									className="h-7 px-2 text-xs"
									onClick={() => applyPreset(preset.months)}
								>
									{preset.label}
								</Button>
							))}
							{(startedAtValue !== "" || expiresAtValue !== "") && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="text-muted-foreground h-7 px-2 text-xs"
									onClick={() => {
										setStartedAtValue("");
										setExpiresAtValue("");
									}}
								>
									Clear
								</Button>
							)}
						</div>

						<p className="text-muted-foreground text-xs">
							Presets start a new term today; edit the dates directly to
							backdate one. Leave both empty for an open-ended plan.
						</p>
					</div>

					<div className="space-y-3 rounded-lg border p-3">
						<div className="flex items-center justify-between gap-2">
							<Label htmlFor="manageTrialActive">Enterprise trial</Label>
							<div className="flex items-center gap-2">
								{trialActiveValue && previewLive?.kind === "trial" ? (
									<span className="text-muted-foreground text-xs tabular-nums">
										{formatPlanTermLabel(previewLive.term)}
									</span>
								) : null}
								<Switch
									id="manageTrialActive"
									checked={trialActiveValue}
									onCheckedChange={setTrialActiveValue}
								/>
							</div>
						</div>

						{trialActiveValue && (
							<div className="grid grid-cols-2 gap-3">
								<div className="space-y-1.5">
									<Label
										htmlFor="manageTrialStart"
										className="text-muted-foreground text-xs font-normal"
									>
										Starts
									</Label>
									<Input
										id="manageTrialStart"
										type="date"
										value={trialStartValue}
										onChange={(e) => setTrialStartValue(e.target.value)}
									/>
								</div>
								<div className="space-y-1.5">
									<Label
										htmlFor="manageTrialEnd"
										className="text-muted-foreground text-xs font-normal"
									>
										Ends
									</Label>
									<Input
										id="manageTrialEnd"
										type="date"
										value={trialEndValue}
										onChange={(e) => setTrialEndValue(e.target.value)}
									/>
								</div>
							</div>
						)}

						<div className="flex flex-wrap items-center gap-1.5">
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 px-2 text-xs"
								onClick={startTrial}
							>
								Start {ENTERPRISE_TRIAL_DAYS}-day trial
							</Button>
							{trialActiveValue && (
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className="text-muted-foreground h-7 px-2 text-xs"
									onClick={() => setTrialActiveValue(false)}
								>
									End trial
								</Button>
							)}
						</div>

						<p className="text-muted-foreground text-xs">
							While a trial runs it is the countdown the customer sees, ahead of
							the plan term. Ending one keeps the dates on record as history.
						</p>
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
