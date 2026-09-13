"use client";

import { Bell, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useUser } from "@/hooks/useUser";
import { Button } from "@/lib/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/lib/components/dialog";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { Switch } from "@/lib/components/switch";
import { useApi } from "@/lib/fetch-client";

const descriptions = {
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
			"Hear about elevated errors from providers you used in the last 30 days, at most once a day per provider and project.",
	},
};

export function UsageNotifications() {
	const api = useApi();
	const { user } = useUser();
	const [open, setOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const alerts = api.useQuery(
		"get",
		"/notifications",
		{},
		{ refetchInterval: 60000 },
	);
	const preferences = api.useQuery(
		"get",
		"/notifications/preferences",
		{},
		{ enabled: settingsOpen },
	);
	const save = api.useMutation("put", "/notifications/preferences", {
		onSuccess: () => {
			void preferences.refetch();
			toast.success("Notification preference saved");
		},
		onError: () => toast.error("Could not save your notification preference"),
	});
	const markRead = api.useMutation("post", "/notifications/read", {
		onSuccess: () => {
			void alerts.refetch();
		},
		onError: () => toast.error("Could not mark notifications as read"),
	});
	const unread = alerts.data?.unreadCount ?? 0;
	return (
		<>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="relative h-9 w-9"
						aria-label={
							unread ? `Notifications, ${unread} unread` : "Notifications"
						}
					>
						<Bell className="h-[18px] w-[18px]" />
						{unread > 0 && (
							<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary" />
						)}
					</Button>
				</PopoverTrigger>
				<PopoverContent
					align="end"
					className="w-[min(420px,calc(100vw-24px))] p-0"
				>
					<div className="flex items-center justify-between border-b p-4">
						<h3 className="font-semibold">Notifications</h3>
						<Button
							variant="ghost"
							size="icon"
							aria-label="Notification settings"
							onClick={() => {
								setOpen(false);
								setSettingsOpen(true);
							}}
						>
							<Settings2 className="h-4 w-4" />
						</Button>
					</div>
					<div className="max-h-[400px] overflow-y-auto">
						{alerts.isLoading ? (
							<p className="p-6 text-sm text-muted-foreground">
								Loading notifications…
							</p>
						) : alerts.isError ? (
							<div className="p-6 text-sm" role="alert">
								Could not load notifications.{" "}
								<Button variant="link" onClick={() => void alerts.refetch()}>
									Retry
								</Button>
							</div>
						) : !alerts.data?.notifications.length ? (
							<div className="space-y-2 p-6 text-center">
								<p className="text-sm font-medium">You’re all caught up</p>
								<p className="text-sm text-muted-foreground">
									Choose alerts for budgets, model retirements, and provider
									issues.
								</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										setOpen(false);
										setSettingsOpen(true);
									}}
								>
									Choose alerts
								</Button>
							</div>
						) : (
							alerts.data.notifications.map((item) => (
								<Link
									key={item.id}
									href={item.href}
									onClick={() => {
										if (!item.readAt) {
											markRead.mutate({ body: { ids: [item.id] } });
										}
										setOpen(false);
									}}
									className={`block space-y-1 border-b p-4 hover:bg-muted/50 ${item.readAt ? "" : "bg-primary/5"}`}
								>
									<p className="text-sm font-medium">
										{!item.readAt && (
											<span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-primary" />
										)}
										{item.title}
									</p>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{item.message}
									</p>
									<time
										dateTime={item.createdAt}
										className="text-xs text-muted-foreground"
									>
										{new Date(item.createdAt).toLocaleDateString()}
									</time>
								</Link>
							))
						)}
					</div>
					{unread > 0 && (
						<div className="p-2">
							<Button
								variant="ghost"
								size="sm"
								disabled={markRead.isPending}
								onClick={() =>
									markRead.mutate({
										body: {
											all: true,
										},
									})
								}
							>
								Mark all as read
							</Button>
						</div>
					)}
				</PopoverContent>
			</Popover>
			<Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
				<DialogContent className="sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>Notification settings</DialogTitle>
						<DialogDescription>
							Choose how you hear about changes that affect your usage. These
							preferences apply across your projects.
						</DialogDescription>
					</DialogHeader>
					{preferences.isLoading ? (
						<p>Loading preferences…</p>
					) : preferences.isError ? (
						<p role="alert">
							Could not load preferences.{" "}
							<Button variant="link" onClick={() => void preferences.refetch()}>
								Retry
							</Button>
						</p>
					) : (
						<div className="divide-y">
							<div className="grid grid-cols-[1fr_60px_60px] gap-3 pb-3 text-center text-xs text-muted-foreground">
								<span />
								<span>In-app</span>
								<span>Email</span>
							</div>
							{preferences.data?.preferences.map((preference) => (
								<div
									key={preference.type}
									className="grid grid-cols-[1fr_60px_60px] items-start gap-3 py-4"
								>
									<div className="space-y-1">
										<p className="text-sm font-medium">
											{descriptions[preference.type].title}
										</p>
										<p className="text-xs leading-relaxed text-muted-foreground">
											{descriptions[preference.type].description}
										</p>
										{preference.type === "budget" && (
											<label className="flex items-center gap-2 pt-2 text-xs">
												Alert at
												<select
													aria-label="Budget alert threshold"
													className="rounded-md border bg-background px-2 py-1"
													value={preference.budgetThreshold}
													disabled={save.isPending || preferences.isFetching}
													onChange={(e) =>
														save.mutate({
															body: {
																...preference,
																budgetThreshold: Number(e.target.value),
															},
														})
													}
												>
													{[50, 60, 70, 80, 90, 95, 100].map((value) => (
														<option key={value} value={value}>
															{value}%
														</option>
													))}
												</select>
												of the limit
											</label>
										)}
									</div>
									{(["inApp", "email"] as const).map((channel) => (
										<div key={channel} className="flex justify-center pt-1">
											<Switch
												aria-label={`${descriptions[preference.type].title} ${channel === "inApp" ? "in-app" : "email"}`}
												checked={preference[channel]}
												disabled={
													save.isPending ||
													preferences.isFetching ||
													(channel === "email" && !user?.emailVerified)
												}
												onCheckedChange={(checked) =>
													save.mutate({
														body: { ...preference, [channel]: checked },
													})
												}
											/>
										</div>
									))}
								</div>
							))}
						</div>
					)}
					{!user?.emailVerified && (
						<p className="text-xs text-muted-foreground">
							Verify your email address to enable email alerts.
						</p>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
