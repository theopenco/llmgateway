"use client";

import {
	ArrowLeft,
	CalendarDays,
	Settings2,
	Sparkles,
	Video,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { initials, money, SegmentChip } from "./crm-meta";

import type { paths } from "@/lib/api/v1";

type CallsResponse =
	paths["/admin/crm/calls"]["get"]["responses"]["200"]["content"]["application/json"];
export type CrmCall = CallsResponse["calls"][number];

export function callHref(call: Pick<CrmCall, "integrationId" | "eventId">) {
	return `/crm/calls/${encodeURIComponent(call.integrationId)}/${encodeURIComponent(call.eventId)}`;
}

export function timeRange(call: Pick<CrmCall, "startAt" | "endAt" | "allDay">) {
	if (call.allDay) {
		return "All day";
	}
	const fmt = (iso: string) =>
		new Date(iso).toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		});
	return `${fmt(call.startAt)} – ${fmt(call.endAt)}`;
}

function dayLabel(iso: string) {
	const d = new Date(iso);
	const today = new Date();
	const tomorrow = new Date(today.getTime() + 86_400_000);
	if (d.toDateString() === today.toDateString()) {
		return "Today";
	}
	if (d.toDateString() === tomorrow.toDateString()) {
		return "Tomorrow";
	}
	return d.toLocaleDateString("en-US", {
		weekday: "long",
		month: "short",
		day: "numeric",
	});
}

export function AttendeeChips({
	attendees,
	limit = 4,
}: {
	attendees: CrmCall["attendees"];
	limit?: number;
}) {
	const outside = attendees.filter((a) => !a.internal);
	const shown = outside.slice(0, limit);
	return (
		<span className="flex flex-wrap items-center gap-1">
			{shown.map((a) => (
				<span
					key={a.email}
					title={`${a.email} · ${a.responseStatus}`}
					className={cn(
						"inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]",
						a.responseStatus === "declined" ? "line-through opacity-60" : "",
					)}
				>
					<span
						className={cn(
							"h-1.5 w-1.5 rounded-full",
							a.responseStatus === "accepted"
								? "bg-emerald-500"
								: a.responseStatus === "declined"
									? "bg-rose-500"
									: a.responseStatus === "tentative"
										? "bg-amber-500"
										: "bg-zinc-400",
						)}
					/>
					{a.name ?? a.email}
				</span>
			))}
			{outside.length > shown.length ? (
				<span className="text-[11px] text-muted-foreground">
					+{outside.length - shown.length}
				</span>
			) : null}
		</span>
	);
}

function CallRow({ call }: { call: CrmCall }) {
	const started = new Date(call.startAt).getTime() <= Date.now();
	return (
		<li>
			<Link
				href={callHref(call)}
				className="flex items-start gap-4 px-4 py-3 transition hover:bg-muted/50"
			>
				<span className="w-36 shrink-0 whitespace-nowrap pt-0.5 text-xs tabular-nums text-muted-foreground">
					{timeRange(call)}
					{started ? (
						<span className="ml-1 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold uppercase text-emerald-700 dark:text-emerald-300">
							now
						</span>
					) : null}
				</span>
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-foreground text-xs font-bold text-background">
					{initials(call.account?.name ?? call.suggestedDomain ?? call.summary)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
						<span className="truncate">{call.summary}</span>
						{call.account ? (
							<SegmentChip segment={call.account.segment} />
						) : (
							<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
								not in CRM
							</span>
						)}
					</p>
					<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
						{call.account ? (
							<span className="font-medium text-foreground/80">
								{call.account.name}
								{call.account.dealValue
									? ` · ${money(call.account.dealValue)}`
									: ""}
								{call.account.openTasks
									? ` · ${call.account.openTasks} open follow-up${call.account.openTasks === 1 ? "" : "s"}`
									: ""}
							</span>
						) : call.suggestedDomain ? (
							<span className="font-mono">{call.suggestedDomain}</span>
						) : null}
						<AttendeeChips attendees={call.attendees} />
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1">
					{call.joinUrl ? (
						<Button
							size="sm"
							variant="outline"
							asChild
							onClick={(e) => e.stopPropagation()}
						>
							<a href={call.joinUrl} target="_blank" rel="noreferrer">
								<Video className="h-4 w-4" />
								Join
							</a>
						</Button>
					) : null}
					<Button size="sm">
						<Sparkles className="h-4 w-4" />
						Prepare
					</Button>
				</div>
			</Link>
		</li>
	);
}

export function CrmCalls() {
	const $api = useApi();
	const [days, setDays] = useState(14);
	const { data, isLoading, error } = $api.useQuery(
		"get",
		"/admin/crm/calls",
		{ params: { query: { days } } },
		{ staleTime: 60_000 },
	);
	const groups = new Map<string, CrmCall[]>();
	for (const call of data?.calls ?? []) {
		const key = new Date(call.startAt).toDateString();
		groups.set(key, [...(groups.get(key) ?? []), call]);
	}
	const connected = data?.calendars.filter((c) => c.calendar) ?? [];
	const needsReconnect = data?.calendars.filter((c) => !c.calendar) ?? [];

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-8">
			<Link
				href="/crm"
				className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				All accounts
			</Link>
			<header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
						Enterprise desk
					</p>
					<h1 className="mt-1 font-display text-4xl font-bold tracking-tight">
						Upcoming calls
					</h1>
					<p className="mt-1 max-w-xl text-sm text-muted-foreground">
						Meetings with people outside the company from{" "}
						{connected.length
							? connected.map((c) => c.email).join(", ")
							: "your Google Calendar"}
						, matched to CRM accounts. Open one to get the briefing.
					</p>
				</div>
				<div className="flex items-center gap-1 rounded-lg border border-border/70 p-0.5">
					{[7, 14, 30].map((d) => (
						<button
							key={d}
							type="button"
							onClick={() => setDays(d)}
							className={cn(
								"rounded-md px-2.5 py-1 text-xs font-medium transition",
								days === d
									? "bg-foreground text-background"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{d} days
						</button>
					))}
				</div>
			</header>

			{needsReconnect.length ? (
				<p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
					<CalendarDays className="h-4 w-4" />
					{needsReconnect.map((c) => c.email).join(", ")} was connected before
					calendar access existed.
					<Link href="/crm/settings" className="underline">
						Reconnect it
					</Link>{" "}
					to see its calls here.
				</p>
			) : null}
			{data?.errors.map((e) => (
				<p
					key={e.calendar}
					className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
				>
					{e.calendar}: {e.message}
				</p>
			))}

			{isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : null}
			{error ? (
				<p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700">
					Could not load calendars.
				</p>
			) : null}
			{data && !connected.length && !needsReconnect.length ? (
				<div className="rounded-xl border border-dashed border-border p-10 text-center">
					<CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
					<p className="mt-3 text-sm font-medium">No calendar connected</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Connect your Gmail on the integrations page; calendar access comes
						with it.
					</p>
					<Button asChild size="sm" className="mt-4">
						<Link href="/crm/settings">
							<Settings2 className="h-4 w-4" />
							Integrations
						</Link>
					</Button>
				</div>
			) : null}
			{data && connected.length && groups.size === 0 ? (
				<div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
					No external calls in the next {days} days.
				</div>
			) : null}
			{Array.from(groups.entries()).map(([key, calls]) => (
				<section key={key}>
					<h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						{dayLabel(calls[0]!.startAt)}
						<span className="ml-2 font-mono">{calls.length}</span>
					</h2>
					<ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card">
						{calls.map((call) => (
							<CallRow
								key={`${call.integrationId}:${call.eventId}`}
								call={call}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
