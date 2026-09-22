"use client";

import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Checkbox } from "@/lib/components/checkbox";
import { Label } from "@/lib/components/label";
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import {
	getCompliantProvidersForModel,
	getProviderDefinition,
	models,
	providers,
	type ProviderCompliancePolicy,
} from "@llmgateway/models";
import { MultiModelSelector } from "@llmgateway/shared/components";

interface Member {
	userId: string;
	role: string;
	user: { email: string; name: string | null };
}

interface ComplianceAlertsCardProps {
	organizationId: string;
	savedPolicy: ProviderCompliancePolicy;
	members: Member[];
	preferencesUrl: string;
}

function modelName(modelId: string): string {
	return models.find((m) => m.id === modelId)?.name ?? modelId;
}

export function ComplianceAlertsCard({
	organizationId,
	savedPolicy,
	members,
	preferencesUrl,
}: ComplianceAlertsCardProps) {
	const api = useApi();
	const queryClient = useQueryClient();
	const params = { params: { path: { organizationId } } };
	const alertsQuery = api.useQuery(
		"get",
		"/orgs/{organizationId}/compliance-alerts",
		params,
	);
	const channelsQuery = api.useQuery(
		"get",
		"/orgs/{organizationId}/notification-channels",
		params,
	);
	const invalidate = async () =>
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions(
				"get",
				"/orgs/{organizationId}/compliance-alerts",
				params,
			).queryKey,
		});
	const addWatches = api.useMutation(
		"post",
		"/orgs/{organizationId}/compliance-alerts/watches",
		{ onSuccess: invalidate },
	);
	const removeWatch = api.useMutation(
		"delete",
		"/orgs/{organizationId}/compliance-alerts/watches/{watchId}",
		{ onSuccess: invalidate },
	);
	const saveSettings = api.useMutation(
		"put",
		"/orgs/{organizationId}/compliance-alerts/settings",
		{ onSuccess: invalidate },
	);

	const slackConfigured = !!channelsQuery.data?.channels.some(
		(c) => c.kind === "slack",
	);
	const data = alertsQuery.data;
	const [inApp, setInApp] = useState(true);
	const [email, setEmail] = useState(true);
	const [slack, setSlack] = useState(false);
	const [downgrades, setDowngrades] = useState(true);
	const [recipients, setRecipients] = useState<string[]>([]);
	const [pendingModels, setPendingModels] = useState<string[]>([]);

	// Load saved settings; owners and admins are preselected until first save.
	useEffect(() => {
		if (!data) {
			return;
		}
		setInApp(data.settings?.inApp ?? true);
		setEmail(data.settings?.email ?? true);
		setSlack(data.settings?.channels.includes("slack") ?? false);
		setDowngrades(data.settings?.downgrades ?? true);
		setRecipients(
			data.settings
				? data.recipientUserIds
				: members
						.filter((m) => m.role === "owner" || m.role === "admin")
						.map((m) => m.userId),
		);
	}, [data, members]);

	const watchedIds = useMemo(
		() => new Set(data?.watches.map((w) => w.modelId) ?? []),
		[data],
	);
	// Only models with no compliant provider in the catalogue can be watched.
	const blockedModels = useMemo(
		() =>
			models.filter(
				(model) =>
					!watchedIds.has(model.id) &&
					getCompliantProvidersForModel(model.id, model.providers, savedPolicy)
						.length === 0,
			),
		[savedPolicy, watchedIds],
	);

	const handleAdd = async () => {
		try {
			await addWatches.mutateAsync({
				...params,
				body: { modelIds: pendingModels },
			});
			setPendingModels([]);
		} catch {
			toast({
				title: "Error",
				description: "Failed to watch models.",
				variant: "destructive",
			});
		}
	};

	const handleSave = async () => {
		try {
			await saveSettings.mutateAsync({
				...params,
				body: {
					inApp,
					email,
					channels: slack ? ["slack"] : [],
					downgrades,
					recipientUserIds: recipients,
				},
			});
			toast({
				title: "Settings saved",
				description: "Compliance alert delivery has been updated.",
			});
		} catch {
			toast({
				title: "Error",
				description: "Failed to save compliance alert settings.",
				variant: "destructive",
			});
		}
	};

	const toggleRecipient = (userId: string, checked: boolean) =>
		setRecipients((current) =>
			checked ? [...current, userId] : current.filter((id) => id !== userId),
		);

	return (
		<Card>
			<CardHeader>
				<CardTitle>Compliance Alerts</CardTitle>
				<CardDescription>
					Watch models that no provider meeting this policy serves yet, and get
					notified as soon as one becomes available. You can also be alerted
					when a provider or watched model stops meeting the policy.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="space-y-2">
					<Label>Watched models</Label>
					<div className="flex flex-col gap-2 sm:flex-row">
						<div className="flex-1">
							<MultiModelSelector
								models={blockedModels}
								providers={providers}
								selectedModels={pendingModels}
								onModelsChange={setPendingModels}
								placeholder="Select blocked models to watch..."
							/>
						</div>
						<Button
							onClick={handleAdd}
							disabled={!pendingModels.length || addWatches.isPending}
						>
							Watch
						</Button>
					</div>
					{data?.watches.length ? (
						<ul className="divide-y rounded-md border">
							{data.watches.map((watch) => (
								<li
									key={watch.id}
									className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
								>
									<div className="min-w-0">
										<div className="font-medium">
											{modelName(watch.modelId)}
										</div>
										{watch.compliantProviders.length ? (
											<div className="text-muted-foreground truncate">
												Via{" "}
												{watch.compliantProviders
													.map((id) => getProviderDefinition(id)?.name ?? id)
													.join(", ")}
											</div>
										) : null}
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{watch.compliantProviders.length ? (
											<Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
												Available
												{watch.availableAt
													? ` since ${new Date(watch.availableAt).toLocaleDateString()}`
													: ""}
											</Badge>
										) : (
											<Badge variant="outline">Waiting</Badge>
										)}
										<Button
											variant="ghost"
											size="icon"
											aria-label={`Stop watching ${modelName(watch.modelId)}`}
											disabled={removeWatch.isPending}
											onClick={() =>
												removeWatch.mutate({
													params: {
														path: { organizationId, watchId: watch.id },
													},
												})
											}
										>
											<X className="h-4 w-4" />
										</Button>
									</div>
								</li>
							))}
						</ul>
					) : (
						<p className="text-sm text-muted-foreground">
							No models watched yet.
						</p>
					)}
				</div>

				<div className="space-y-2">
					<Label>Recipients</Label>
					<p className="text-sm text-muted-foreground">
						Members who receive in-app and email alerts.
					</p>
					<div className="grid gap-2 sm:grid-cols-2">
						{members.map((member) => (
							<label
								key={member.userId}
								className="flex items-center gap-2 text-sm"
							>
								<Checkbox
									checked={recipients.includes(member.userId)}
									onCheckedChange={(checked) =>
										toggleRecipient(member.userId, checked === true)
									}
								/>
								<span className="truncate">
									{member.user.name ?? member.user.email}
								</span>
								<span className="text-muted-foreground capitalize">
									{member.role.replace("_", " ")}
								</span>
							</label>
						))}
					</div>
				</div>

				<div className="space-y-3">
					<Label>Delivery</Label>
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm">In-app</span>
						<Switch checked={inApp} onCheckedChange={setInApp} />
					</div>
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm">Email</span>
						<Switch checked={email} onCheckedChange={setEmail} />
					</div>
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm">
							Slack
							{slackConfigured ? null : (
								<span className="text-muted-foreground">
									{" "}
									—{" "}
									<Link
										href={preferencesUrl}
										className="whitespace-nowrap underline underline-offset-4"
									>
										connect a webhook
									</Link>
								</span>
							)}
						</span>
						<Switch
							checked={slack && slackConfigured}
							disabled={!slackConfigured}
							onCheckedChange={setSlack}
						/>
					</div>
					<div className="flex items-center justify-between gap-4">
						<span className="text-sm">
							Notify when a provider or watched model stops meeting the policy
						</span>
						<Switch checked={downgrades} onCheckedChange={setDowngrades} />
					</div>
				</div>

				<div className="flex justify-end">
					<Button onClick={handleSave} disabled={saveSettings.isPending}>
						{saveSettings.isPending ? "Saving..." : "Save alert settings"}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
