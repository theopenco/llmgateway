"use client";

import {
	CalendarDays,
	CalendarPlus,
	Copy,
	ExternalLink,
	Settings2,
	Video,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { type CrmAccountDetail, relativeDays } from "./crm-meta";

import type { paths } from "@/lib/api/v1";

type MeetingsResponse =
	paths["/admin/crm/accounts/{id}/meetings"]["get"]["responses"]["200"]["content"]["application/json"];
type Meeting = MeetingsResponse["meetings"][number];
type BookingLink = MeetingsResponse["bookingLinks"][number];
type Person = CrmAccountDetail["people"][number];

function whenLabel(iso: string) {
	return new Date(iso).toLocaleString("en-US", {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function durationMin(m: Meeting) {
	return Math.round(
		(new Date(m.endAt).getTime() - new Date(m.startAt).getTime()) / 60_000,
	);
}

function prefilled(link: BookingLink, person: Person | null) {
	const url = new URL(link.url);
	if (person) {
		url.searchParams.set("email", person.email);
		if (person.name) {
			url.searchParams.set("name", person.name);
		}
	}
	return url.toString();
}

function BookingLinks({
	links,
	people,
}: {
	links: BookingLink[];
	people: Person[];
}) {
	const [personEmail, setPersonEmail] = useState(people[0]?.email ?? "");
	const person = people.find((p) => p.email === personEmail) ?? null;
	if (!links.length) {
		return null;
	}
	return (
		<section className="rounded-xl border border-border/70 bg-card p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					<CalendarPlus className="h-3.5 w-3.5" />
					Offer a time
				</h3>
				<select
					className="h-8 rounded-md border border-border bg-background px-2 text-xs"
					value={personEmail}
					onChange={(e) => setPersonEmail(e.target.value)}
				>
					<option value="">Blank invite</option>
					{people.map((p) => (
						<option key={p.email} value={p.email}>
							Prefill for {p.name ?? p.email}
						</option>
					))}
				</select>
			</div>
			<ul className="mt-3 flex flex-wrap gap-2">
				{links.map((l) => {
					const url = prefilled(l, person);
					return (
						<li
							key={`${l.integrationId}:${l.url}`}
							className="flex items-center gap-1 rounded-lg border border-border/70 pl-3 pr-1 text-xs"
						>
							<span className="py-1.5">
								<span className="font-medium">{l.name}</span>
								<span className="text-muted-foreground">
									{" "}
									· {l.duration} min · {l.owner}
								</span>
							</span>
							<Button
								size="icon"
								variant="ghost"
								className="h-7 w-7"
								aria-label="Copy booking link"
								onClick={() => {
									void navigator.clipboard.writeText(url);
									toast.success("Booking link copied");
								}}
							>
								<Copy className="h-3.5 w-3.5" />
							</Button>
							<Button
								size="icon"
								variant="ghost"
								className="h-7 w-7"
								aria-label="Open booking page"
								asChild
							>
								<a href={url} target="_blank" rel="noreferrer">
									<ExternalLink className="h-3.5 w-3.5" />
								</a>
							</Button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function MeetingRow({ m, people }: { m: Meeting; people: Person[] }) {
	const person = people.find((p) => p.email === m.inviteeEmail);
	const past = new Date(m.endAt).getTime() < Date.now();
	return (
		<li
			className={cn(
				"flex items-start gap-3 px-4 py-3",
				m.status === "canceled" ? "opacity-60" : "",
			)}
		>
			<span
				className={cn(
					"mt-0.5 flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg text-[10px] font-semibold uppercase leading-none",
					past
						? "bg-muted text-muted-foreground"
						: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
				)}
			>
				{new Date(m.startAt).toLocaleString("en-US", { month: "short" })}
				<span className="mt-0.5 text-sm">{new Date(m.startAt).getDate()}</span>
			</span>
			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-center gap-2 text-sm font-medium">
					<span className={m.status === "canceled" ? "line-through" : ""}>
						{m.name}
					</span>
					{m.status === "canceled" ? (
						<span className="rounded bg-rose-500/10 px-1.5 py-px text-[10px] font-semibold uppercase text-rose-600">
							canceled
						</span>
					) : null}
				</p>
				<p className="text-xs text-muted-foreground">
					{whenLabel(m.startAt)} · {durationMin(m)} min · with{" "}
					{person?.name ?? m.inviteeEmail} · hosted by {m.host}
				</p>
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1 text-right">
				<span className="text-[11px] text-muted-foreground">
					{relativeDays(m.startAt)}
				</span>
				{m.joinUrl && !past && m.status === "active" ? (
					<a
						href={m.joinUrl}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
					>
						<Video className="h-3.5 w-3.5" />
						Join
					</a>
				) : null}
			</div>
		</li>
	);
}

export function MeetingsPanel({
	accountId,
	people,
}: {
	accountId: string;
	people: Person[];
}) {
	const $api = useApi();
	const { data, isLoading, error, refetch, isFetching } = $api.useQuery(
		"get",
		"/admin/crm/accounts/{id}/meetings",
		{ params: { path: { id: accountId } } },
		{ staleTime: 60_000 },
	);
	if (isLoading) {
		return <Skeleton className="h-64 w-full rounded-xl" />;
	}
	if (error || !data) {
		return (
			<p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700">
				Could not reach the Calendly integration.
			</p>
		);
	}
	if (
		!data.bookingLinks.length &&
		!data.meetings.length &&
		!data.errors.length
	) {
		return (
			<div className="rounded-xl border border-dashed border-border p-10 text-center">
				<CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
				<p className="mt-3 text-sm font-medium">No meetings yet</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Connect Calendly to see calls booked with this account and hand out
					booking links from here.
				</p>
				<Button asChild size="sm" variant="outline" className="mt-4">
					<Link href="/crm/settings">
						<Settings2 className="h-4 w-4" />
						Integrations
					</Link>
				</Button>
			</div>
		);
	}
	const upcoming = data.meetings
		.filter((m) => new Date(m.endAt).getTime() >= Date.now())
		.sort((a, b) => a.startAt.localeCompare(b.startAt));
	const past = data.meetings.filter(
		(m) => new Date(m.endAt).getTime() < Date.now(),
	);
	return (
		<div className="flex flex-col gap-4">
			<BookingLinks links={data.bookingLinks} people={people} />
			{data.errors.map((e) => (
				<p
					key={e.host}
					className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
				>
					{e.host}: {e.message}
				</p>
			))}
			<div className="flex items-center justify-between">
				<p className="text-xs text-muted-foreground">
					Calendly events with this account's contacts. Each one is mirrored
					into the activity feed.
				</p>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => void refetch()}
					disabled={isFetching}
				>
					Sync
				</Button>
			</div>
			{[
				{ label: "Upcoming", items: upcoming },
				{ label: "Past", items: past },
			]
				.filter((g) => g.items.length)
				.map((g) => (
					<section key={g.label}>
						<h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{g.label} · {g.items.length}
						</h3>
						<ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card">
							{g.items.map((m) => (
								<MeetingRow key={m.eventUri} m={m} people={people} />
							))}
						</ul>
					</section>
				))}
			{data.meetings.length === 0 ? (
				<p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
					No calls booked with this account yet.
				</p>
			) : null}
		</div>
	);
}
