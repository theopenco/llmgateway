"use client";

import { AlertTriangle, KeyRound } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "@/hooks/useUser";

export default function LicenseRequiredPage() {
	const { data } = useUser();
	const status = data?.enterpriseLicense?.status ?? "missing";

	return (
		<main className="flex min-h-svh items-center justify-center bg-muted/30 p-6">
			<Card className="w-full max-w-xl">
				<CardHeader>
					<div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
						<AlertTriangle className="h-6 w-6" />
					</div>
					<CardTitle>White-label license required</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4 text-sm text-muted-foreground">
					<p>
						The admin dashboard is locked because the deployment license is
						{status === "expired" ? " expired" : ` ${status}`}.
					</p>
					<div className="flex gap-3 rounded-lg border bg-background p-4">
						<KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-foreground" />
						<p>
							Install a white-label <code>LLMGATEWAY_ENTERPRISE_LICENSE</code>
							in the API and gateway environments, then restart the deployment.
							A standard Enterprise license unlocks one organization, but not
							this multi-organization admin dashboard.
						</p>
					</div>
				</CardContent>
			</Card>
		</main>
	);
}
