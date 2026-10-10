"use client";

import { Bell, Settings2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/lib/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { useDashboardContext } from "@/lib/dashboard-context";
import { useApi } from "@/lib/fetch-client";

export function UsageNotifications() {
	const api = useApi();
	const { selectedOrganization } = useDashboardContext();
	const [open, setOpen] = useState(false);
	const alerts = api.useQuery(
		"get",
		"/notifications",
		{},
		{ refetchInterval: 60000 },
	);
	const markRead = api.useMutation("post", "/notifications/read", {
		onSuccess: () => {
			void alerts.refetch();
		},
		onError: () => toast.error("Could not mark notifications as read"),
	});
	const unread = alerts.data?.unreadCount ?? 0;
	const settingsHref = `/dashboard/${selectedOrganization?.id}/org/notifications`;
	return (
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
						<span className="bg-primary absolute top-1 right-1 h-2 w-2 rounded-full" />
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
						asChild
					>
						<Link href={settingsHref} onClick={() => setOpen(false)}>
							<Settings2 className="h-4 w-4" />
						</Link>
					</Button>
				</div>
				<div className="max-h-[400px] overflow-y-auto">
					{alerts.isLoading ? (
						<p className="text-muted-foreground p-6 text-sm">
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
							<p className="text-sm font-medium">You're all caught up</p>
							<p className="text-muted-foreground text-sm">
								Choose alerts for budgets, model retirements, and provider
								issues.
							</p>
							<Button variant="outline" size="sm" asChild>
								<Link href={settingsHref} onClick={() => setOpen(false)}>
									Choose alerts
								</Link>
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
								className={`hover:bg-muted/50 block space-y-1 border-b p-4 ${item.readAt ? "" : "bg-primary/5"}`}
							>
								<p className="text-sm font-medium">
									{!item.readAt && (
										<span className="bg-primary mr-2 inline-block h-1.5 w-1.5 rounded-full" />
									)}
									{item.title}
								</p>
								<p className="text-muted-foreground text-xs leading-relaxed">
									{item.message}
								</p>
								<time
									dateTime={item.createdAt}
									className="text-muted-foreground text-xs"
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
	);
}
