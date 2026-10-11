"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	AlarmClock,
	ArrowDownRight,
	ArrowUpRight,
	Download,
	KanbanSquare,
	Plus,
	Search,
	Table2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCsv } from "@/lib/download-csv";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import {
	accountHref,
	type CrmAccount,
	type CrmAccountsResponse,
	type CrmSegment,
	type CrmStage,
	initials,
	money,
	relativeDays,
	ScoreRing,
	SegmentChip,
	SEGMENTS,
	STAGES,
	stageLabel,
	trendPct,
} from "./crm-meta";

type View = "board" | "table";

function Kpi({
	label,
	value,
	hint,
	tone,
}: {
	label: string;
	value: string;
	hint?: string;
	tone?: "warn" | "good";
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1 px-5 py-4">
			<span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</span>
			<span className="font-display text-2xl font-semibold tabular-nums tracking-tight">
				{value}
			</span>
			{hint ? (
				<span
					className={cn(
						"text-xs",
						tone === "warn"
							? "text-rose-600 dark:text-rose-400"
							: tone === "good"
								? "text-emerald-600 dark:text-emerald-400"
								: "text-muted-foreground",
					)}
				>
					{hint}
				</span>
			) : null}
		</div>
	);
}

function Trend({ current, previous }: { current: number; previous: number }) {
	const pct = trendPct(current, previous);
	if (pct === null) {
		return <span className="text-[11px] text-emerald-600">new</span>;
	}
	if (pct === 0) {
		return null;
	}
	const up = pct > 0;
	return (
		<span
			className={cn(
				"inline-flex items-center text-[11px] tabular-nums",
				up ? "text-emerald-600" : "text-rose-600",
			)}
		>
			{up ? (
				<ArrowUpRight className="h-3 w-3" />
			) : (
				<ArrowDownRight className="h-3 w-3" />
			)}
			{Math.abs(pct)}%
		</span>
	);
}

function OwnerBadge({ email }: { email: string | null }) {
	if (!email) {
		return (
			<span className="whitespace-nowrap text-[11px] text-muted-foreground">
				Unassigned
			</span>
		);
	}
	return (
		<span
			className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background"
			title={email}
		>
			{initials(email.split("@")[0]!.replace(/[._-]/g, " "))}
		</span>
	);
}

function BoardCard({
	account,
	onDragStart,
}: {
	account: CrmAccount;
	onDragStart: (id: string) => void;
}) {
	return (
		<Link
			href={accountHref(account.id)}
			draggable
			onDragStart={(e) => {
				e.dataTransfer.setData("text/plain", account.id);
				e.dataTransfer.effectAllowed = "move";
				onDragStart(account.id);
			}}
			className="group block cursor-grab rounded-lg border border-border/70 bg-card p-3 shadow-[0_1px_0_rgba(0,0,0,0.03)] transition hover:-translate-y-0.5 hover:border-foreground/20 hover:shadow-md active:cursor-grabbing"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold">{account.name}</p>
					<p className="truncate font-mono text-[11px] text-muted-foreground">
						{account.domain ?? account.primaryContact?.email ?? account.id}
					</p>
				</div>
				<ScoreRing
					score={account.score.score}
					label={account.score.label}
					size={30}
				/>
			</div>
			<div className="mt-3 flex items-center justify-between gap-2">
				<SegmentChip segment={account.segment} />
				<span className="font-mono text-xs font-medium tabular-nums">
					{money(account.dealValue)}
				</span>
			</div>
			<div className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-border/70 pt-2">
				{account.nextTaskDueAt ? (
					<span
						className={cn(
							"inline-flex items-center gap-1 text-[11px]",
							account.overdueTasks > 0
								? "font-medium text-rose-600"
								: "text-muted-foreground",
						)}
					>
						<AlarmClock className="h-3 w-3" />
						{relativeDays(account.nextTaskDueAt)}
					</span>
				) : (
					<span className="whitespace-nowrap text-[11px] text-muted-foreground">
						No follow-up set
					</span>
				)}
				<OwnerBadge email={account.ownerEmail} />
			</div>
		</Link>
	);
}

function Board({
	accounts,
	onMove,
}: {
	accounts: CrmAccount[];
	onMove: (id: string, stage: CrmStage) => void;
}) {
	const [dragging, setDragging] = useState<string | null>(null);
	const [over, setOver] = useState<CrmStage | null>(null);
	return (
		<div className="-mx-4 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8">
			<div className="grid w-max auto-cols-[272px] grid-flow-col gap-3">
				{STAGES.map((stage) => {
					const items = accounts.filter((a) => a.stage === stage.value);
					const total = items.reduce((s, a) => s + (a.dealValue ?? 0), 0);
					return (
						<div
							key={stage.value}
							onDragOver={(e) => {
								e.preventDefault();
								setOver(stage.value);
							}}
							onDragLeave={() => setOver(null)}
							onDrop={(e) => {
								e.preventDefault();
								const id = e.dataTransfer.getData("text/plain") || dragging;
								setOver(null);
								setDragging(null);
								if (id) {
									onMove(id, stage.value);
								}
							}}
							className={cn(
								"flex min-h-[420px] flex-col gap-2 rounded-xl border border-transparent bg-muted/40 p-2 transition-colors",
								over === stage.value &&
									"border-foreground/20 bg-muted/80 ring-2 ring-foreground/5",
							)}
						>
							<div className="flex items-center justify-between px-1 pb-1 pt-0.5">
								<div className="flex items-center gap-2">
									<span className={cn("h-2 w-2 rounded-sm", stage.bar)} />
									<span className="text-xs font-semibold">{stage.label}</span>
									<span className="font-mono text-[11px] text-muted-foreground">
										{items.length}
									</span>
								</div>
								<span className="font-mono text-[11px] text-muted-foreground">
									{total > 0 ? money(total) : ""}
								</span>
							</div>
							{items.map((a) => (
								<BoardCard key={a.id} account={a} onDragStart={setDragging} />
							))}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function AccountsTable({ accounts }: { accounts: CrmAccount[] }) {
	const router = useRouter();
	return (
		<div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
			<table className="w-full text-sm">
				<thead>
					<tr className="border-b border-border/70 text-left text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
						<th className="px-4 py-3 font-medium">Company</th>
						<th className="px-3 py-3 font-medium">Segment</th>
						<th className="px-3 py-3 font-medium">Stage</th>
						<th className="px-3 py-3 font-medium">Score</th>
						<th className="px-3 py-3 text-right font-medium">Deal</th>
						<th className="px-3 py-3 text-right font-medium">Spend 30d</th>
						<th className="px-3 py-3 font-medium">Contact</th>
						<th className="px-3 py-3 font-medium">Next step</th>
						<th className="px-3 py-3 font-medium">Owner</th>
					</tr>
				</thead>
				<tbody>
					{accounts.map((a) => (
						<tr
							key={a.id}
							onClick={() => router.push(accountHref(a.id))}
							className="cursor-pointer border-b border-border/50 transition-colors last:border-0 hover:bg-muted/40"
						>
							<td className="px-4 py-3">
								<div className="flex items-center gap-3">
									<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted font-display text-xs font-bold">
										{initials(a.name)}
									</span>
									<div className="min-w-0">
										<p className="truncate font-medium">{a.name}</p>
										<p className="truncate font-mono text-[11px] text-muted-foreground">
											{a.domain ?? a.id}
											{a.orgs.length > 0
												? ` · ${a.orgs.length} org${a.orgs.length > 1 ? "s" : ""}`
												: ""}
										</p>
									</div>
								</div>
							</td>
							<td className="px-3 py-3">
								<SegmentChip segment={a.segment} />
							</td>
							<td className="px-3 py-3 text-xs">
								{stageLabel(a.stage)}
								{a.stageOverridden ? null : (
									<span className="ml-1 text-muted-foreground">(auto)</span>
								)}
							</td>
							<td className="px-3 py-3">
								<div
									className="flex items-center gap-2"
									title={a.score.reasons.join("\n")}
								>
									<ScoreRing
										score={a.score.score}
										label={a.score.label}
										size={28}
									/>
									<span className="text-[11px] text-muted-foreground">
										{a.scoreKind === "lead" ? "fit" : "health"}
									</span>
								</div>
							</td>
							<td className="px-3 py-3 text-right font-mono tabular-nums">
								{money(a.dealValue)}
							</td>
							<td className="px-3 py-3 text-right">
								<div className="flex flex-col items-end">
									<span className="font-mono tabular-nums">
										{a.orgs.length ? money(a.spend30d) : "—"}
									</span>
									{a.orgs.length ? (
										<Trend current={a.spend30d} previous={a.spendPrev30d} />
									) : null}
								</div>
							</td>
							<td className="px-3 py-3">
								{a.primaryContact ? (
									<div className="min-w-0">
										<p className="truncate text-xs font-medium">
											{a.primaryContact.name ?? "—"}
										</p>
										<p className="truncate text-[11px] text-muted-foreground">
											{a.primaryContact.email}
										</p>
									</div>
								) : (
									"—"
								)}
							</td>
							<td className="px-3 py-3 text-xs">
								{a.nextTaskDueAt ? (
									<span
										className={cn(
											a.overdueTasks > 0 && "font-medium text-rose-600",
										)}
									>
										{a.openTasks} task{a.openTasks > 1 ? "s" : ""} ·{" "}
										{relativeDays(a.nextTaskDueAt)}
									</span>
								) : a.segment === "trial" && a.trialEndsAt ? (
									<span className="text-amber-600">
										Trial ends {relativeDays(a.trialEndsAt)}
									</span>
								) : a.renewalAt ? (
									<span className="text-muted-foreground">
										Renews {relativeDays(a.renewalAt)}
									</span>
								) : (
									<span className="text-muted-foreground">—</span>
								)}
							</td>
							<td className="px-3 py-3">
								<OwnerBadge email={a.ownerEmail} />
							</td>
						</tr>
					))}
					{accounts.length === 0 ? (
						<tr>
							<td
								colSpan={9}
								className="px-4 py-16 text-center text-sm text-muted-foreground"
							>
								No accounts match these filters.
							</td>
						</tr>
					) : null}
				</tbody>
			</table>
		</div>
	);
}

function NewAccountDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const $api = useApi();
	const router = useRouter();
	const [domain, setDomain] = useState("");
	const [name, setName] = useState("");
	const [deal, setDeal] = useState("");
	const create = $api.useMutation("post", "/admin/crm/accounts", {
		onSuccess: (data) => {
			onOpenChange(false);
			router.push(accountHref(data.id));
		},
		onError: () => toast.error("Could not create the account"),
	});
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Track a new prospect</DialogTitle>
					<DialogDescription>
						For outbound or referral deals that never filled the contact form.
						It merges automatically once someone from that domain signs up or
						reaches out.
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						create.mutate({
							body: {
								domain,
								name,
								dealValue: deal ? Number(deal) : undefined,
							},
						});
					}}
				>
					<div className="grid gap-1.5">
						<Label htmlFor="crm-domain">Company domain</Label>
						<Input
							id="crm-domain"
							placeholder="acme.com"
							value={domain}
							onChange={(e) => setDomain(e.target.value)}
							required
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="crm-name">Company name</Label>
						<Input
							id="crm-name"
							placeholder="Acme Inc."
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="crm-deal">Expected ACV (USD)</Label>
						<Input
							id="crm-deal"
							type="number"
							min={0}
							placeholder="50000"
							value={deal}
							onChange={(e) => setDeal(e.target.value)}
						/>
					</div>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={create.isPending}>
							{create.isPending ? "Creating…" : "Create account"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function exportCsv(accounts: CrmAccount[]) {
	const header = [
		"Company",
		"Domain",
		"Segment",
		"Stage",
		"Score",
		"Deal value",
		"Spend 30d",
		"Contact name",
		"Contact email",
		"Owner",
		"Country",
		"Size",
		"Renewal",
		"Trial ends",
		"Open tasks",
	];
	const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
	const rows = accounts.map((a) =>
		[
			a.name,
			a.domain,
			a.segment,
			a.stage,
			a.score.score,
			a.dealValue,
			a.spend30d.toFixed(2),
			a.primaryContact?.name,
			a.primaryContact?.email,
			a.ownerEmail,
			a.country,
			a.size,
			a.renewalAt?.slice(0, 10),
			a.trialEndsAt?.slice(0, 10),
			a.openTasks,
		]
			.map(esc)
			.join(","),
	);
	downloadCsv(
		`crm-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
		[header.map(esc).join(","), ...rows].join("\n"),
	);
}

export function CrmOverview() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const [view, setView] = useState<View>("board");
	const [segment, setSegment] = useState<CrmSegment | "all">("all");
	const [search, setSearch] = useState("");
	const [newOpen, setNewOpen] = useState(false);
	const listOptions = $api.queryOptions("get", "/admin/crm/accounts");
	const { data, isLoading } = $api.useQuery("get", "/admin/crm/accounts");
	const update = $api.useMutation("patch", "/admin/crm/accounts/{id}", {
		onSettled: () => {
			void queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
		},
	});

	const accounts = useMemo(() => {
		const q = search.trim().toLowerCase();
		return (data?.accounts ?? []).filter(
			(a) =>
				(segment === "all" || a.segment === segment) &&
				(!q ||
					a.name.toLowerCase().includes(q) ||
					a.domain?.includes(q) ||
					a.primaryContact?.email.includes(q) ||
					a.primaryContact?.name?.toLowerCase().includes(q) ||
					a.tags.some((t) => t.includes(q))),
		);
	}, [data, segment, search]);

	const moveStage = (id: string, stage: CrmStage) => {
		const current = data?.accounts.find((a) => a.id === id);
		if (!current || current.stage === stage) {
			return;
		}
		const previous = queryClient.getQueryData<CrmAccountsResponse>(
			listOptions.queryKey,
		);
		queryClient.setQueryData<CrmAccountsResponse>(
			listOptions.queryKey,
			(old) =>
				old && {
					...old,
					accounts: old.accounts.map((a) =>
						a.id === id ? { ...a, stage, stageOverridden: true } : a,
					),
				},
		);
		update.mutate(
			{ params: { path: { id } }, body: { stage } },
			{
				onSuccess: () =>
					toast.success(`${current.name} → ${stageLabel(stage)}`),
				onError: () => {
					queryClient.setQueryData(listOptions.queryKey, previous);
					toast.error(`Could not move ${current.name}`);
				},
			},
		);
	};

	const k = data?.kpis;
	const counts = (s: CrmSegment) =>
		data?.accounts.filter((a) => a.segment === s).length ?? 0;

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
						Enterprise desk
					</p>
					<h1 className="mt-1 font-display text-4xl font-bold tracking-tight">
						Accounts
					</h1>
					<p className="mt-1 max-w-xl text-sm text-muted-foreground">
						Customers, trials and everyone who reached out, merged per company
						by email domain.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="outline" size="sm" asChild>
						<Link href="/crm/tasks">
							<AlarmClock className="h-4 w-4" />
							Follow-ups
							{k && k.overdueTasks > 0 ? (
								<span className="ml-1 rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">
									{k.overdueTasks}
								</span>
							) : null}
						</Link>
					</Button>
					<Button
						variant="outline"
						size="sm"
						onClick={() => exportCsv(accounts)}
						disabled={!accounts.length}
					>
						<Download className="h-4 w-4" />
						Export CSV
					</Button>
					<Button size="sm" onClick={() => setNewOpen(true)}>
						<Plus className="h-4 w-4" />
						New account
					</Button>
				</div>
			</header>

			<section className="grid grid-cols-2 divide-x divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card md:grid-cols-3 md:divide-y-0 xl:grid-cols-6">
				{k ? (
					<>
						<Kpi
							label="Contracted ACV"
							value={money(k.contractedArr)}
							hint={`${k.customers} customers`}
						/>
						<Kpi
							label="Open pipeline"
							value={money(k.pipelineValue)}
							hint="Open deals, unweighted"
						/>
						<Kpi
							label="Gateway spend 30d"
							value={money(k.spend30d)}
							hint="Across customer & trial orgs"
						/>
						<Kpi
							label="Trials"
							value={String(k.trials)}
							hint={
								k.trialsEndingSoon
									? `${k.trialsEndingSoon} ending within 14 days`
									: "None ending soon"
							}
							tone={k.trialsEndingSoon ? "warn" : undefined}
						/>
						<Kpi
							label="Reached out"
							value={String(k.leads)}
							hint={`${k.newLeads7d} new submissions this week`}
							tone={k.newLeads7d ? "good" : undefined}
						/>
						<Kpi
							label="Needs attention"
							value={String(k.atRisk + k.overdueTasks)}
							hint={`${k.atRisk} at risk · ${k.overdueTasks} overdue · ${k.renewalsSoon} renewals ≤60d`}
							tone={k.atRisk + k.overdueTasks ? "warn" : undefined}
						/>
					</>
				) : (
					Array.from({ length: 6 }, (_, i) => (
						<div key={i} className="px-5 py-4">
							<Skeleton className="h-3 w-20" />
							<Skeleton className="mt-3 h-7 w-24" />
						</div>
					))
				)}
			</section>

			<div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
				<div className="flex flex-wrap items-center gap-1.5">
					<button
						type="button"
						onClick={() => setSegment("all")}
						className={cn(
							"rounded-full px-3 py-1 text-xs font-medium transition",
							segment === "all"
								? "bg-foreground text-background"
								: "text-muted-foreground hover:bg-muted",
						)}
					>
						All{" "}
						<span className="ml-1 font-mono">{data?.accounts.length ?? 0}</span>
					</button>
					{SEGMENTS.map((s) => (
						<button
							type="button"
							key={s.value}
							onClick={() => setSegment(s.value)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition",
								segment === s.value
									? "bg-foreground text-background"
									: "text-muted-foreground hover:bg-muted",
							)}
						>
							<span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
							{s.label}
							<span className="font-mono">{counts(s.value)}</span>
						</button>
					))}
				</div>
				<div className="flex items-center gap-2">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Company, person, domain, tag…"
							className="h-8 w-64 pl-8 text-xs"
						/>
					</div>
					<div className="flex rounded-lg border border-border/70 p-0.5">
						<button
							type="button"
							onClick={() => setView("board")}
							aria-label="Pipeline board"
							className={cn(
								"rounded-md p-1.5",
								view === "board" ? "bg-muted" : "text-muted-foreground",
							)}
						>
							<KanbanSquare className="h-4 w-4" />
						</button>
						<button
							type="button"
							onClick={() => setView("table")}
							aria-label="Table"
							className={cn(
								"rounded-md p-1.5",
								view === "table" ? "bg-muted" : "text-muted-foreground",
							)}
						>
							<Table2 className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>

			{isLoading ? (
				<Skeleton className="h-[420px] w-full rounded-xl" />
			) : view === "board" ? (
				<Board accounts={accounts} onMove={moveStage} />
			) : (
				<AccountsTable accounts={accounts} />
			)}

			<NewAccountDialog open={newOpen} onOpenChange={setNewOpen} />
		</div>
	);
}
