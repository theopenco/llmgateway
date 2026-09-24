"use client";

import { useQueryClient } from "@tanstack/react-query";

import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { getApiErrorMessage } from "@/lib/api-error";
import { Label } from "@/lib/components/label";
import { Skeleton } from "@/lib/components/skeleton";
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

const CATEGORIES = [
	{
		key: "marketing",
		title: "Product tips and offers",
		description:
			"Onboarding nudges, feature announcements and occasional campaigns.",
	},
	{
		key: "creditAlerts",
		title: "Credit balance reminders",
		description:
			"Emails when your balance runs low or your credits have not been topped up in a while.",
	},
] as const;

export function EmailPreferencesSettings() {
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardContext();
	const organizationId = selectedOrganization?.id ?? "";
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const canManage = role === "owner" || role === "admin";

	const api = useApi();
	const params = { params: { path: { organizationId } } };
	const preferencesQuery = api.useQuery(
		"get",
		"/orgs/{organizationId}/email-preferences",
		params,
		{ enabled: !!organizationId },
	);

	const update = api.useMutation(
		"patch",
		"/orgs/{organizationId}/email-preferences",
		{
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: api.queryOptions(
						"get",
						"/orgs/{organizationId}/email-preferences",
						params,
					).queryKey,
				});
			},
		},
	);

	const preferences = preferencesQuery.data?.preferences;

	const handleToggle = async (
		key: "marketing" | "creditAlerts",
		value: boolean,
	) => {
		try {
			await update.mutateAsync({ ...params, body: { [key]: value } });
			toast({ title: "Email preferences updated" });
		} catch (error) {
			toast({
				title: "Error",
				description: getApiErrorMessage(
					error,
					"Failed to update email preferences.",
				),
				variant: "destructive",
			});
		}
	};

	if (preferencesQuery.isLoading || !preferences) {
		return <Skeleton className="h-24 w-full" />;
	}

	return (
		<div className="space-y-6">
			{CATEGORIES.map((category) => (
				<div
					key={category.key}
					className="flex items-start justify-between gap-4"
				>
					<div className="space-y-1">
						<Label htmlFor={`email-${category.key}`}>{category.title}</Label>
						<p className="text-muted-foreground text-sm">
							{category.description}
						</p>
					</div>
					<Switch
						id={`email-${category.key}`}
						checked={preferences[category.key]}
						disabled={!canManage || update.isPending}
						onCheckedChange={(value) => handleToggle(category.key, value)}
					/>
				</div>
			))}
			<p className="text-muted-foreground text-xs">
				Invoices, security notices and other account email are always sent.
				{!canManage &&
					" Only organization owners and admins can change these settings."}
			</p>
		</div>
	);
}
