"use client";

import dynamic from "next/dynamic";

import { useDevPlanStatus } from "@/app/dashboard/useDevPlanStatus";
import { useUser } from "@/hooks/useUser";

const DevPlanSettings = dynamic(
	() => import("@/app/dashboard/components/DevPlanSettings"),
);

export default function SettingsPage() {
	const { user } = useUser();
	const { data: devPlanStatus } = useDevPlanStatus();

	if (!devPlanStatus) {
		return null;
	}

	return (
		<div className="space-y-10">
			<div>
				<h1 className="text-lg font-semibold tracking-tight">Settings</h1>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Control how DevPass routes and stores your requests.
				</p>
			</div>

			{/* Account */}
			<div>
				<h2 className="mb-4 font-semibold">Account</h2>
				<div className="rounded-xl border p-5">
					<div className="space-y-0.5">
						<p className="text-sm font-medium">Email</p>
						<p className="text-sm text-muted-foreground">
							{user?.email ?? "—"}
						</p>
					</div>
				</div>
			</div>

			<DevPlanSettings
				devPlanAllowAllModels={devPlanStatus.devPlanAllowAllModels ?? false}
				retentionLevel={devPlanStatus.retentionLevel ?? "none"}
			/>
		</div>
	);
}
