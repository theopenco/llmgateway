"use client";

import { AlertTriangle } from "lucide-react";

import { useUser } from "@/hooks/useUser";
import { Alert, AlertDescription, AlertTitle } from "@/lib/components/alert";
import { useDashboardContext } from "@/lib/dashboard-context";

export function EnterpriseLicenseBanner() {
	const { data } = useUser();
	const { selectedOrganization } = useDashboardContext();
	const license = data?.enterpriseLicense;

	if (selectedOrganization?.plan !== "enterprise" || !license) {
		return null;
	}

	if (
		selectedOrganization.enterpriseAccess === true &&
		license.status === "grace"
	) {
		return (
			<Alert className="rounded-none border-x-0 border-t-0 border-amber-500/40 bg-amber-500/10 px-6 text-amber-950 dark:text-amber-100">
				<AlertTriangle />
				<AlertTitle>Enterprise license expired</AlertTitle>
				<AlertDescription>
					Enterprise access remains available during the seven-day grace period.
					Install a renewed license before {license.graceEndsAt ?? "grace ends"}
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
