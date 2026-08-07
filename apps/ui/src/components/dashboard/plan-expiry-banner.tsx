"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { formatTermDate } from "@/components/billing/enterprise-plan-term";
import { useDashboardState } from "@/lib/dashboard-state";
import { cn } from "@/lib/utils";

import { formatPlanTermLabel, getOrganizationTerm } from "@llmgateway/shared";

/**
 * Quiet countdown strip for enterprise agreements and trials that are close to
 * lapsing.
 *
 * It stays invisible for the whole healthy stretch of a term — the last 30 days
 * of a contract, the last 7 of a trial — so it never becomes background noise
 * the way an always-on plan banner would. A dismissal is remembered per end
 * date, so renewing (or an admin moving the date) surfaces it again next term.
 */
export function PlanExpiryBanner() {
	const { selectedOrganization } = useDashboardState();
	const [dismissed, setDismissed] = useState(true);

	const resolved =
		selectedOrganization?.plan === "enterprise"
			? getOrganizationTerm({
					isTrialActive: selectedOrganization.isTrialActive,
					trialStartDate: selectedOrganization.trialStartDate,
					trialEndDate: selectedOrganization.trialEndDate,
					planStartedAt: selectedOrganization.planStartedAt,
					planExpiresAt: selectedOrganization.planExpiresAt,
				})
			: null;
	const term = resolved?.term ?? null;
	const trial = resolved?.kind === "trial";

	const storageKey =
		selectedOrganization && term
			? `plan-expiry-dismissed:${selectedOrganization.id}:${term.expiresAt.toISOString()}`
			: null;

	useEffect(() => {
		if (!storageKey) {
			return;
		}
		setDismissed(window.localStorage.getItem(storageKey) === "1");
	}, [storageKey]);

	if (!term || term.status === "active") {
		return null;
	}

	// Billing is an owner/admin concern; project-scoped developers can't act on it.
	if (selectedOrganization?.role === "developer") {
		return null;
	}

	const expired = term.status === "expired";

	// An expired agreement or trial is not a nag, it is a live problem — it
	// stays put.
	if (dismissed && !expired) {
		return null;
	}

	const handleDismiss = () => {
		if (storageKey) {
			window.localStorage.setItem(storageKey, "1");
		}
		setDismissed(true);
	};

	return (
		<div
			className={cn(
				"flex items-center gap-3 border-b px-4 py-2.5 text-sm",
				expired || term.status === "critical"
					? "border-red-500/25 bg-red-500/[0.07] text-red-900 dark:text-red-100"
					: "border-amber-500/25 bg-amber-500/[0.07] text-amber-900 dark:text-amber-100",
			)}
		>
			<span
				aria-hidden
				className={cn(
					"h-1.5 w-1.5 shrink-0 rounded-full",
					expired || term.status === "critical" ? "bg-red-500" : "bg-amber-500",
				)}
			/>
			<p className="min-w-0 flex-1">
				<span className="font-medium">
					Your enterprise {trial ? "trial" : "agreement"}{" "}
					{expired ? "ended" : "ends"} on{" "}
					<span className="tabular-nums">{formatTermDate(term.expiresAt)}</span>
				</span>
				<span className="opacity-80"> — {formatPlanTermLabel(term)}.</span>
			</p>
			<Link
				href="/enterprise"
				className="shrink-0 font-medium underline underline-offset-4"
			>
				{trial ? "Talk to sales" : "Renew"}
			</Link>
			{!expired && (
				<button
					type="button"
					onClick={handleDismiss}
					aria-label="Dismiss renewal reminder"
					className="shrink-0 rounded-sm opacity-60 transition-opacity hover:opacity-100"
				>
					<X className="h-4 w-4" />
				</button>
			)}
		</div>
	);
}
