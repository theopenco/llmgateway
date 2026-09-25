"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { getApiErrorMessage } from "@/lib/api-error";
import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { toast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

export function NotificationChannelsSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardContext();
	const organizationId = selectedOrganization?.id ?? "";
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const isAdmin = role === "owner" || role === "admin";
	const enterprise = selectedOrganization?.enterpriseAccess === true;
	// Saving and testing require enterprise access on the server; removal does not.
	const canConfigure = isAdmin && enterprise;

	const api = useApi();
	const params = { params: { path: { organizationId } } };
	const channelsQuery = api.useQuery(
		"get",
		"/orgs/{organizationId}/notification-channels",
		params,
		{ enabled: !!organizationId },
	);
	const invalidate = async () => {
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions(
				"get",
				"/orgs/{organizationId}/notification-channels",
				params,
			).queryKey,
		});
		await queryClient.invalidateQueries({
			queryKey: api.queryOptions(
				"get",
				"/orgs/{organizationId}/compliance-alerts",
				params,
			).queryKey,
		});
	};
	const save = api.useMutation(
		"put",
		"/orgs/{organizationId}/notification-channels/slack",
		{ onSuccess: invalidate },
	);
	const remove = api.useMutation(
		"delete",
		"/orgs/{organizationId}/notification-channels/slack",
		{ onSuccess: invalidate },
	);
	const test = api.useMutation(
		"post",
		"/orgs/{organizationId}/notification-channels/slack/test",
	);

	const [webhookUrl, setWebhookUrl] = useState("");
	const slack = channelsQuery.data?.channels.find((c) => c.kind === "slack");

	const handleSave = async () => {
		try {
			await save.mutateAsync({ ...params, body: { webhookUrl } });
			setWebhookUrl("");
			toast({ title: "Slack webhook saved" });
		} catch (error) {
			toast({
				title: "Error",
				description: getApiErrorMessage(error, "Failed to save Slack webhook."),
				variant: "destructive",
			});
		}
	};

	const handleTest = async () => {
		try {
			await test.mutateAsync(params);
			toast({ title: "Test message sent to Slack" });
		} catch (error) {
			toast({
				title: "Error",
				description: getApiErrorMessage(error, "Failed to send test message."),
				variant: "destructive",
			});
		}
	};

	const handleRemove = async () => {
		try {
			await remove.mutateAsync(params);
			toast({ title: "Slack webhook removed" });
		} catch (error) {
			toast({
				title: "Error",
				description: getApiErrorMessage(
					error,
					"Failed to remove Slack webhook.",
				),
				variant: "destructive",
			});
		}
	};

	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Label htmlFor="slackWebhook">Slack incoming webhook</Label>
				{slack ? (
					<p className="text-sm">
						Connected: <span className="font-mono">{slack.target}</span>
					</p>
				) : (
					<p className="text-sm text-muted-foreground">Not connected.</p>
				)}
				{canConfigure ? (
					<Input
						id="slackWebhook"
						type="url"
						placeholder="https://hooks.slack.com/services/…"
						value={webhookUrl}
						onChange={(e) => setWebhookUrl(e.target.value)}
					/>
				) : null}
				<p className="text-sm text-muted-foreground">
					{enterprise
						? "Create an incoming webhook in Slack for the channel that should receive organization alerts, then paste its URL here."
						: "Notification channels are available on the Enterprise plan."}
				</p>
			</div>
			{isAdmin ? (
				<div className="flex flex-wrap justify-end gap-2">
					{slack ? (
						<Button
							variant="outline"
							onClick={handleRemove}
							disabled={remove.isPending}
						>
							Remove
						</Button>
					) : null}
					{slack && canConfigure ? (
						<Button
							variant="outline"
							onClick={handleTest}
							disabled={test.isPending}
						>
							{test.isPending ? "Sending..." : "Send test message"}
						</Button>
					) : null}
					{canConfigure ? (
						<Button
							onClick={handleSave}
							disabled={!webhookUrl.trim() || save.isPending}
						>
							{save.isPending
								? "Saving..."
								: slack
									? "Replace webhook"
									: "Save webhook"}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
