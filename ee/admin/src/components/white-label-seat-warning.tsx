"use client";

import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useApi } from "@/lib/fetch-client";

export function WhiteLabelSeatWarning() {
	const api = useApi();
	const { data } = api.useQuery(
		"get",
		"/admin/license",
		{},
		{
			staleTime: 60_000,
			refetchInterval: 60_000,
			refetchOnWindowFocus: true,
		},
	);

	if (
		!data ||
		data.kind !== "white_label" ||
		!data.enterpriseEnabled ||
		data.maxSeats === null ||
		data.maxSeats <= 0 ||
		data.seatsUsed / data.maxSeats < 0.8
	) {
		return null;
	}

	const atCapacity = data.seatsUsed >= data.maxSeats;
	const percentUsed = Math.floor((data.seatsUsed / data.maxSeats) * 100);

	return (
		<Alert
			className={
				atCapacity
					? "rounded-none border-x-0 border-t-0 border-red-500/40 bg-red-500/10 px-6 text-red-950 dark:text-red-100"
					: "rounded-none border-x-0 border-t-0 border-orange-500/40 bg-orange-500/10 px-6 text-orange-950 dark:text-orange-100"
			}
		>
			<AlertTriangle aria-hidden="true" />
			<AlertTitle className="line-clamp-none">
				{atCapacity
					? "White-label seat limit reached"
					: "White-label seats are running low"}
			</AlertTitle>
			<AlertDescription className="text-current/90">
				<p>
					{data.seatsUsed.toLocaleString("en-US")} of{" "}
					{data.maxSeats.toLocaleString("en-US")} seats used across enterprise
					organizations ({percentUsed}%).{" "}
					{atCapacity
						? "New enterprise members are blocked. Install a license with more seats to resume provisioning."
						: "Install a license with more seats before provisioning is blocked."}
				</p>
			</AlertDescription>
		</Alert>
	);
}
