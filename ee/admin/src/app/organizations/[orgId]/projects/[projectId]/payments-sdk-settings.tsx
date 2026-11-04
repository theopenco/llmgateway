"use client";

import { useQueryClient } from "@tanstack/react-query";

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiErrorMessage } from "@/lib/api-error";
import { useApi } from "@/lib/fetch-client";

export function PaymentsSdkSettings({
	orgId,
	projectId,
	canWrite,
}: {
	orgId: string;
	projectId: string;
	canWrite: boolean;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const params = { path: { orgId, projectId } };
	const options = $api.queryOptions(
		"get",
		"/admin/organizations/{orgId}/projects/{projectId}/payments-sdk",
		{ params },
	);
	const settings = $api.useQuery(
		"get",
		"/admin/organizations/{orgId}/projects/{projectId}/payments-sdk",
		{ params },
	);
	const update = $api.useMutation(
		"patch",
		"/admin/organizations/{orgId}/projects/{projectId}/payments-sdk",
		{
			meta: { errorMessage: "Failed to update Payments SDK access" },
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey: options.queryKey });
			},
		},
	);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Payments SDK</CardTitle>
				<CardDescription>
					Unlock setup so project admins can enable end-user sessions and create
					platform secret keys in Settings → Payments SDK. Locking setup does
					not stop existing sessions or payments.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{settings.isPending ? (
					<p className="text-sm text-muted-foreground">Loading settings…</p>
				) : settings.isError ? (
					<p className="text-sm text-destructive">
						{apiErrorMessage(
							settings.error,
							"Failed to load Payments SDK access",
						)}
					</p>
				) : (
					<div className="flex items-center justify-between gap-4">
						<div>
							<Label htmlFor="payments-sdk-access">
								Unlock Payments SDK setup
							</Label>
							<p className="text-xs text-muted-foreground">
								{settings.data.paymentsSdkEnabled
									? "Setup unlocked"
									: "Setup locked"}
							</p>
						</div>
						<Switch
							id="payments-sdk-access"
							checked={settings.data.paymentsSdkEnabled}
							disabled={!canWrite || update.isPending}
							onCheckedChange={(paymentsSdkEnabled) =>
								update.mutate({ params, body: { paymentsSdkEnabled } })
							}
						/>
					</div>
				)}
			</CardContent>
		</Card>
	);
}
