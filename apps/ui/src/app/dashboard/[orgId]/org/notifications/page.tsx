"use client";

import { toast } from "sonner";

import { useUser } from "@/hooks/useUser";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Skeleton } from "@/lib/components/skeleton";
import { Switch } from "@/lib/components/switch";
import { useApi } from "@/lib/fetch-client";

import type { EmailCategory } from "@llmgateway/shared/email-unsubscribe";

const DESCRIPTIONS: Record<
	EmailCategory,
	{ title: string; description: string }
> = {
	budget: {
		title: "API key budgets",
		description:
			"Get a warning as a key approaches its total or recurring limit.",
	},
	model_retirement: {
		title: "Model retirements",
		description:
			"Plan ahead when a model you use is due to be deprecated or deactivated within 30 days.",
	},
	provider_issue: {
		title: "Provider issues",
		description:
			"Hear about elevated errors from providers you used in the last 30 days.",
	},
	model_available: {
		title: "Compliance: models available",
		description:
			"When you are a compliance alert recipient, hear when a watched model becomes available under your organization's policy.",
	},
	compliance_downgrade: {
		title: "Compliance: downgrades",
		description:
			"When you are a compliance alert recipient, hear when a provider or watched model stops meeting your organization's policy.",
	},
	marketing: {
		title: "Product tips and offers",
		description:
			"Onboarding nudges, feature announcements and occasional campaigns.",
	},
	credit_alerts: {
		title: "Credit balance reminders",
		description:
			"Emails when your balance runs low or your credits have not been topped up in a while.",
	},
};

const THRESHOLDS = [50, 60, 70, 80, 90, 95, 100];

export default function NotificationsPage() {
	const api = useApi();
	const { user } = useUser();
	const preferences = api.useQuery("get", "/notifications/preferences", {});
	const save = api.useMutation("put", "/notifications/preferences", {
		onSuccess: () => {
			void preferences.refetch();
			toast.success("Notification preference saved");
		},
		onError: () => toast.error("Could not save your notification preference"),
	});
	const busy = save.isPending || preferences.isFetching;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="space-y-6">
					<div className="space-y-1">
						<h2 className="text-3xl font-bold tracking-tight">Notifications</h2>
						<p className="text-muted-foreground text-sm">
							Choose how you hear about changes that affect your usage. These
							preferences are yours and apply across every organization you
							belong to.
						</p>
					</div>
					<Card>
						<CardHeader>
							<CardTitle>Delivery</CardTitle>
						</CardHeader>
						<CardContent>
							{preferences.isLoading ? (
								<Skeleton className="h-64 w-full" />
							) : preferences.isError ? (
								<p role="alert" className="text-sm">
									Could not load preferences.
								</p>
							) : (
								<div className="divide-y">
									<div className="text-muted-foreground grid grid-cols-[1fr_60px_60px] gap-3 pb-3 text-center text-xs">
										<span />
										<span>In-app</span>
										<span>Email</span>
									</div>
									{preferences.data?.preferences.map((preference) => {
										const copy = DESCRIPTIONS[preference.category];
										return (
											<div
												key={preference.category}
												className="grid grid-cols-[1fr_60px_60px] items-start gap-3 py-4"
											>
												<div className="space-y-1">
													<p className="text-sm font-medium">{copy.title}</p>
													<p className="text-muted-foreground text-xs leading-relaxed">
														{copy.description}
													</p>
													{preference.budgetThreshold !== null && (
														<label className="flex items-center gap-2 pt-2 text-xs">
															Alert at
															<select
																aria-label="Budget alert threshold"
																className="bg-background rounded-md border px-2 py-1"
																value={preference.budgetThreshold}
																disabled={busy}
																onChange={(e) =>
																	save.mutate({
																		body: {
																			...preference,
																			budgetThreshold: Number(e.target.value),
																		},
																	})
																}
															>
																{THRESHOLDS.map((value) => (
																	<option key={value} value={value}>
																		{value}%
																	</option>
																))}
															</select>
														</label>
													)}
												</div>
												<div className="flex justify-center">
													{preference.inApp === null ? (
														<span
															className="text-muted-foreground text-xs"
															aria-label="Not available in the notification feed"
														>
															—
														</span>
													) : (
														<Switch
															aria-label={`${copy.title} in-app`}
															checked={preference.inApp}
															disabled={busy}
															onCheckedChange={(inApp) =>
																save.mutate({ body: { ...preference, inApp } })
															}
														/>
													)}
												</div>
												<div className="flex justify-center">
													<Switch
														aria-label={`${copy.title} email`}
														checked={preference.email}
														disabled={busy || !user?.emailVerified}
														onCheckedChange={(email) =>
															save.mutate({ body: { ...preference, email } })
														}
													/>
												</div>
											</div>
										);
									})}
								</div>
							)}
						</CardContent>
					</Card>
					{!user?.emailVerified && (
						<p className="text-muted-foreground text-xs">
							Verify your email address to enable email alerts.
						</p>
					)}
					{preferences.data?.email && (
						<p className="text-muted-foreground text-xs">
							Email preferences apply to {preferences.data.email}. Invoices,
							security notices and other account email are always sent.
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
