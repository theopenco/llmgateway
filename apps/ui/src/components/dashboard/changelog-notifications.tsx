"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";

export interface AnnouncementEntry {
	slug: string;
	title: string;
	summary: string;
	date: string;
	type: "changelog" | "blog";
}

interface AnnouncementNotificationsProps {
	entries: AnnouncementEntry[];
}

const LAST_SEEN_KEY = "announcements_last_seen";

export function ChangelogNotifications({
	entries,
}: AnnouncementNotificationsProps) {
	const [lastSeen, setLastSeen] = useState<string | null>(null);
	const [open, setOpen] = useState(false);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setLastSeen(localStorage.getItem(LAST_SEEN_KEY));
		setMounted(true);
	}, []);

	const unreadCount = mounted
		? entries.filter((e) => !lastSeen || new Date(e.date) > new Date(lastSeen))
				.length
		: 0;

	const markAsRead = () => {
		const now = new Date().toISOString();
		localStorage.setItem(LAST_SEEN_KEY, now);
		setLastSeen(now);
	};

	const handleOpenChange = (isOpen: boolean) => {
		setOpen(isOpen);
		if (isOpen && unreadCount > 0) {
			markAsRead();
		}
	};

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					aria-label={
						unreadCount > 0
							? `${unreadCount} unread announcement${unreadCount === 1 ? "" : "s"}`
							: "Changelog notifications"
					}
					className="relative h-9 w-9 text-muted-foreground hover:text-foreground"
				>
					<Bell className="h-[18px] w-[18px]" />
					{unreadCount > 0 && (
						<span className="absolute top-1.5 right-1.5 flex h-2 w-2">
							<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
							<span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
						</span>
					)}
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-[360px] p-0" sideOffset={8}>
				<div className="flex items-center justify-between border-b border-border px-4 py-3">
					<h3 className="text-sm font-semibold tracking-tight">
						What&apos;s New
					</h3>
					<Link
						href="/changelog"
						className="text-xs text-muted-foreground hover:text-foreground transition-colors"
						onClick={() => setOpen(false)}
					>
						View all
					</Link>
				</div>
				<div className="max-h-[320px] overflow-y-auto divide-y divide-border">
					{entries.map((entry) => (
						<Link
							key={`${entry.type}-${entry.slug}`}
							href={
								entry.type === "blog"
									? `/blog/${entry.slug}`
									: `/changelog/${entry.slug}`
							}
							className="block px-4 py-3 hover:bg-accent/50 transition-colors"
							onClick={() => setOpen(false)}
							prefetch={true}
						>
							<div className="flex items-center gap-2">
								<time className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
									{new Date(entry.date).toLocaleDateString("en-US", {
										month: "short",
										day: "numeric",
									})}
								</time>
								<span className="text-[10px] font-medium uppercase tracking-wider rounded-full bg-muted px-1.5 py-0.5 text-muted-foreground">
									{entry.type === "blog" ? "Blog" : "Update"}
								</span>
							</div>
							<p className="text-sm font-medium mt-1 leading-snug">
								{entry.title}
							</p>
							<p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
								{entry.summary}
							</p>
						</Link>
					))}
				</div>
				<div className="border-t border-border px-4 py-2.5">
					<Link
						href="/changelog"
						className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
						onClick={() => setOpen(false)}
					>
						See full changelog &rarr;
					</Link>
				</div>
			</PopoverContent>
		</Popover>
	);
}
