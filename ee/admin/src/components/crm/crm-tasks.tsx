"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { addWorkingDays } from "@llmgateway/shared/working-days";

import { accountHref, relativeDays, SegmentChip } from "./crm-meta";

import type { paths } from "@/lib/api/v1";

type Task =
	paths["/admin/crm/tasks"]["get"]["responses"][200]["content"]["application/json"]["tasks"][number];

const WEEK_MS = 6 * 86_400_000;

function bucketOf(task: Task, now: number): string {
	if (!task.dueAt) {
		return "No due date";
	}
	const due = new Date(task.dueAt).getTime();
	const endOfToday = new Date(new Date().setHours(23, 59, 59, 999)).getTime();
	if (due < now) {
		return "Overdue";
	}
	if (due <= endOfToday) {
		return "Today";
	}
	if (due <= endOfToday + WEEK_MS) {
		return "This week";
	}
	return "Later";
}

const ORDER = ["Overdue", "Today", "This week", "Later", "No due date"];

const MOVES = [
	{ label: "Next working day", workdays: 1 },
	{ label: "Next week", workdays: 5 },
];

const START_OF_DAY_HOUR = 9;

/** The start of the day, `workdays` working days from today, in local time. */
function startOfWorkday(workdays: number): Date {
	const today = new Date();
	today.setHours(START_OF_DAY_HOUR, 0, 0, 0);
	return addWorkingDays(today, workdays, "local");
}

const dueDay = new Intl.DateTimeFormat(undefined, {
	weekday: "short",
	month: "short",
	day: "numeric",
});

function TaskRow({
	task,
	overdue,
	registerMoveButton,
	onMoved,
}: {
	task: Task;
	overdue: boolean;
	registerMoveButton: (label: string, node: HTMLButtonElement | null) => void;
	onMoved: (label: string) => void;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const lastMove = useRef<{ label: string; due: Date } | null>(null);
	// One mutation per row, so a slow request on one task leaves the others
	// usable. The callbacks sit on the hook because a moved row re-mounts under
	// another heading before the request settles, and callbacks passed to
	// `mutate` are dropped with the old row.
	const update = $api.useMutation(
		"patch",
		"/admin/crm/activities/{activityId}",
		{
			onSuccess: async (_data, variables) => {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: $api.queryOptions("get", "/admin/crm/tasks").queryKey,
					}),
					queryClient.invalidateQueries({
						queryKey: $api.queryOptions("get", "/admin/crm/accounts").queryKey,
					}),
				]);
				const move = lastMove.current;
				if (variables.body?.completed || !move) {
					toast.success("Follow-up done");
					return;
				}
				toast.success(`Follow-up moved to ${dueDay.format(move.due)}`);
				onMoved(move.label);
			},
			onError: (_error, variables) => {
				toast.error(
					variables.body?.completed
						? "Could not complete the task"
						: "Could not move the follow-up",
				);
			},
		},
	);
	const busy = update.isPending;

	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
			<button
				type="button"
				aria-label={`Mark done: ${task.subject}`}
				aria-disabled={busy}
				onClick={() => {
					if (!busy) {
						update.mutate({
							params: { path: { activityId: task.id } },
							body: { completed: true },
						});
					}
				}}
				className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 text-transparent transition hover:border-emerald-500 hover:text-emerald-500 aria-disabled:opacity-50"
			>
				<Check className="h-3 w-3" />
			</button>
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{task.subject}</p>
				<p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<Link
						href={accountHref(task.accountId)}
						className="font-medium text-foreground/80 hover:underline"
					>
						{task.accountName}
					</Link>
					<SegmentChip segment={task.segment} />
					{task.contactEmail ? (
						<span className="min-w-0 truncate">with {task.contactEmail}</span>
					) : null}
				</p>
			</div>
			<span
				className={cn(
					"shrink-0 text-xs tabular-nums",
					overdue ? "font-semibold text-rose-600" : "text-muted-foreground",
				)}
			>
				{relativeDays(task.dueAt)}
			</span>
			<div className="flex basis-full items-center gap-1 pl-8 sm:basis-auto sm:pl-0">
				{MOVES.map((move) => (
					<button
						key={move.label}
						ref={(node) => registerMoveButton(move.label, node)}
						type="button"
						aria-disabled={busy}
						onClick={() => {
							if (busy) {
								return;
							}
							const due = startOfWorkday(move.workdays);
							lastMove.current = { label: move.label, due };
							update.mutate({
								params: { path: { activityId: task.id } },
								body: { dueAt: due.toISOString() },
							});
						}}
						className="rounded-md border border-border/70 px-2 py-0.5 text-[11px] text-muted-foreground transition hover:border-foreground/40 hover:text-foreground aria-disabled:opacity-50"
					>
						{move.label}
						<span className="sr-only">: {task.subject}</span>
					</button>
				))}
			</div>
		</li>
	);
}

export function CrmTasks() {
	const $api = useApi();
	const { data, isLoading } = $api.useQuery("get", "/admin/crm/tasks");
	const moveButtons = useRef(new Map<string, HTMLButtonElement>());
	const [focusAfterMove, setFocusAfterMove] = useState<string | null>(null);
	// A moved task re-mounts under another heading. Putting focus back on the
	// button that moved it keeps a keyboard user on the same task.
	useEffect(() => {
		if (focusAfterMove) {
			moveButtons.current.get(focusAfterMove)?.focus();
			setFocusAfterMove(null);
		}
	}, [focusAfterMove]);
	const now = Date.now();
	const groups = ORDER.map((label) => ({
		label,
		tasks: (data?.tasks ?? []).filter((t) => bucketOf(t, now) === label),
	})).filter((g) => g.tasks.length);

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 md:px-8">
			<Link
				href="/crm"
				className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				All accounts
			</Link>
			<header>
				<p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
					Enterprise desk
				</p>
				<h1 className="mt-1 font-display text-4xl font-bold tracking-tight">
					Follow-ups
				</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Every open task across customers, trials and leads, oldest first.
				</p>
			</header>
			{isLoading ? <Skeleton className="h-64 w-full rounded-xl" /> : null}
			{!isLoading && groups.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
					Inbox zero. Schedule follow-ups from any account&apos;s activity tab.
				</div>
			) : null}
			{groups.map((g) => (
				<section key={g.label}>
					<h2
						className={cn(
							"mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em]",
							g.label === "Overdue" ? "text-rose-600" : "text-muted-foreground",
						)}
					>
						{g.label}
						<span className="font-mono">{g.tasks.length}</span>
					</h2>
					<ul className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70 bg-card">
						{g.tasks.map((t) => (
							<TaskRow
								key={t.id}
								task={t}
								overdue={g.label === "Overdue"}
								registerMoveButton={(label, node) => {
									const key = `${t.id}:${label}`;
									if (node) {
										moveButtons.current.set(key, node);
									} else {
										moveButtons.current.delete(key);
									}
								}}
								onMoved={(label) => setFocusAfterMove(`${t.id}:${label}`)}
							/>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
