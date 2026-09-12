"use client";

import { AlertTriangle } from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";
import { useDashboardContext } from "@/lib/dashboard-context";

import {
	formatPlanTermLabel,
	getEnterpriseLicenseTerm,
} from "@llmgateway/shared";

function formatDate(date: Date): string {
	return date.toLocaleDateString("en-US", {
		timeZone: "UTC",
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

export function EnterpriseLicenseBanner() {
	const { data } = useUser();
	const { selectedOrganization } = useDashboardContext();
	const license = data?.enterpriseLicense;

	if (selectedOrganization?.plan !== "enterprise" || !license) {
		return null;
	}

	const isLicensedOrganization =
		license.kind === "enterprise" &&
		license.organizationId === selectedOrganization.id;
	const term = isLicensedOrganization
		? getEnterpriseLicenseTerm(license.expiresAt)
		: null;

	if (
		license.status === "active" &&
		term &&
		(term.status === "expiring" || term.status === "critical")
	) {
		const critical = term.status === "critical";

		return (
			<Alert
				className={
					critical
						? "rounded-none border-x-0 border-t-0 border-red-500/40 bg-red-500/10 px-6 text-red-950 dark:text-red-100"
						: "rounded-none border-x-0 border-t-0 border-orange-500/40 bg-orange-500/10 px-6 text-orange-950 dark:text-orange-100"
				}
			>
				<AlertTriangle />
				<AlertTitle>Enterprise license expires soon</AlertTitle>
				<AlertDescription className="text-current/90">
					Install a renewed license before {formatDate(term.expiresAt)} (
					{formatPlanTermLabel(term).toLowerCase()}) to keep Enterprise access.
				</AlertDescription>
			</Alert>
		);
	}

	if (
		isLicensedOrganization &&
		selectedOrganization.enterpriseAccess === true &&
		license.status === "grace"
	) {
		return (
			<Alert className="rounded-none border-x-0 border-t-0 border-red-500/40 bg-red-500/10 px-6 text-red-950 dark:text-red-100">
				<AlertTriangle />
				<AlertTitle>Enterprise license expired</AlertTitle>
				<AlertDescription className="text-current/90">
					Enterprise access remains available during the seven-day grace period.
					Install a renewed license
					{license.graceEndsAt
						? ` before ${formatDate(new Date(license.graceEndsAt))}`
						: " before grace ends"}
					.
				</AlertDescription>
			</Alert>
		);
	}

	if (selectedOrganization.enterpriseAccess !== true) {
		return (
			<Alert
				variant="destructive"
				className="rounded-none border-x-0 border-t-0 px-6"
			>
				<AlertTriangle />
				<AlertTitle>Enterprise features are locked</AlertTitle>
				<AlertDescription>
					{license.enterpriseEnabled
						? "The installed Enterprise license is assigned to a different organization."
						: "This deployment needs a valid Enterprise license. Core gateway functionality remains available."}
				</AlertDescription>
			</Alert>
		);
	}

	return null;
}
