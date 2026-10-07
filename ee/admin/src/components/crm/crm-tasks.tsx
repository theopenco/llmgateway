"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

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

export function CrmTasks() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const { data, isLoading } = $api.useQuery("get", "/admin/crm/tasks");
	const complete = $api.useMutation(
		"patch",
		"/admin/crm/activities/{activityId}",
		{
			onSuccess: () => {
				void queryClient.invalidateQueries({
					queryKey: $api.queryOptions("get", "/admin/crm/tasks").queryKey,
				});
				void queryClient.invalidateQueries({
					queryKey: $api.queryOptions("get", "/admin/crm/accounts").queryKey,
				});
			},
		},
	);
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
					Inbox zero. Schedule follow-ups from any account's activity tab.
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
							<li key={t.id} className="flex items-center gap-3 px-4 py-3">
								<button
									type="button"
									aria-label="Mark done"
									onClick={() => {
										complete.mutate({
											params: { path: { activityId: t.id } },
											body: { completed: true },
										});
										toast.success("Follow-up done");
									}}
									className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/40 text-transparent transition hover:border-emerald-500 hover:text-emerald-500"
								>
									<Check className="h-3 w-3" />
								</button>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-medium">{t.subject}</p>
									<p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
										<Link
											href={accountHref(t.accountId)}
											className="font-medium text-foreground/80 hover:underline"
										>
											{t.accountName}
										</Link>
										<SegmentChip segment={t.segment} />
										{t.contactEmail ? <span>with {t.contactEmail}</span> : null}
									</p>
								</div>
								<span
									className={cn(
										"shrink-0 text-xs tabular-nums",
										g.label === "Overdue"
											? "font-semibold text-rose-600"
											: "text-muted-foreground",
									)}
								>
									{relativeDays(t.dueAt)}
								</span>
							</li>
						))}
					</ul>
				</section>
			))}
		</div>
	);
}
