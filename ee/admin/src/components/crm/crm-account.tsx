"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Building2,
	CalendarClock,
	Check,
	CircleDollarSign,
	ExternalLink,
	Github,
	Globe,
	Linkedin,
	Mail,
	MessageSquareQuote,
	Monitor,
	NotebookPen,
	Pencil,
	Phone,
	PhoneCall,
	Plus,
	Trash2,
	Users,
	Video,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import {
	type CrmAccountDetail,
	initials,
	money,
	relativeDays,
	ScoreRing,
	SegmentChip,
	shortDate,
	STAGES,
	trendPct,
} from "./crm-meta";

type Person = CrmAccountDetail["people"][number];
type Activity = CrmAccountDetail["activities"][number];
type ActivityKind = Activity["kind"];

const ROLE_LABELS: Record<NonNullable<Person["role"]>, string> = {
	champion: "Champion",
	decision_maker: "Decision maker",
	economic_buyer: "Economic buyer",
	technical: "Technical evaluator",
	procurement: "Procurement",
	user: "End user",
	blocker: "Blocker",
};

const KIND_META: Record<
	ActivityKind,
	{ label: string; icon: typeof Mail; tone: string }
> = {
	note: { label: "Note", icon: NotebookPen, tone: "bg-zinc-500" },
	call: { label: "Call", icon: PhoneCall, tone: "bg-indigo-500" },
	email: { label: "Email", icon: Mail, tone: "bg-sky-500" },
	meeting: { label: "Meeting", icon: Video, tone: "bg-violet-500" },
	task: { label: "Task", icon: CalendarClock, tone: "bg-amber-500" },
};

const SYSTEM_TONE: Record<
	CrmAccountDetail["timeline"][number]["kind"],
	string
> = {
	lead: "bg-sky-500",
	org: "bg-zinc-400",
	trial: "bg-amber-500",
	plan: "bg-emerald-500",
	member: "bg-zinc-400",
	payment: "bg-emerald-600",
};

function useAccountMutations(id: string) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const refresh = () => {
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", "/admin/crm/accounts/{id}", {
				params: { path: { id } },
			}).queryKey,
		});
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", "/admin/crm/accounts").queryKey,
		});
	};
	const onError = () => toast.error("Save failed");
	return {
		update: $api.useMutation("patch", "/admin/crm/accounts/{id}", {
			onSuccess: refresh,
			onError,
		}),
		addActivity: $api.useMutation(
			"post",
			"/admin/crm/accounts/{id}/activities",
			{ onSuccess: refresh, onError },
		),
		patchActivity: $api.useMutation(
			"patch",
			"/admin/crm/activities/{activityId}",
			{ onSuccess: refresh, onError },
		),
		deleteActivity: $api.useMutation(
			"delete",
			"/admin/crm/activities/{activityId}",
			{ onSuccess: refresh, onError },
		),
		saveContact: $api.useMutation("put", "/admin/crm/accounts/{id}/contacts", {
			onSuccess: refresh,
			onError,
		}),
	};
}

type Mutations = ReturnType<typeof useAccountMutations>;

const fieldClass =
	"h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-sm font-medium transition hover:border-border focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/30";

function DealField({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
			<span className="px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
				{label}
			</span>
			{children}
		</div>
	);
}

function DealStrip({ detail, m }: { detail: CrmAccountDetail; m: Mutations }) {
	const a = detail.account;
	const path = { params: { path: { id: a.id } } };
	const [owner, setOwner] = useState(a.ownerEmail ?? "");
	const [deal, setDeal] = useState(a.dealValue?.toString() ?? "");
	useEffect(() => {
		setOwner(a.ownerEmail ?? "");
		setDeal(a.dealValue?.toString() ?? "");
	}, [a.ownerEmail, a.dealValue]);
	return (
		<section className="grid grid-cols-2 divide-x divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card md:grid-cols-5 md:divide-y-0">
			<DealField label="Stage">
				<select
					className={fieldClass}
					value={a.stage}
					onChange={(e) => {
						m.update.mutate({
							...path,
							body: { stage: e.target.value as typeof a.stage },
						});
						toast.success("Stage updated");
					}}
				>
					{STAGES.map((s) => (
						<option key={s.value} value={s.value}>
							{s.label}
						</option>
					))}
				</select>
			</DealField>
			<DealField label="Deal value (ACV)">
				<input
					className={cn(fieldClass, "font-mono")}
					inputMode="numeric"
					placeholder="—"
					value={deal}
					onChange={(e) => setDeal(e.target.value.replace(/[^\d.]/g, ""))}
					onBlur={() => {
						const next = deal ? Number(deal) : null;
						if (next !== a.dealValue) {
							m.update.mutate({ ...path, body: { dealValue: next } });
						}
					}}
				/>
			</DealField>
			<DealField label="Expected close">
				<input
					type="date"
					className={fieldClass}
					value={a.closeDate?.slice(0, 10) ?? ""}
					onChange={(e) =>
						m.update.mutate({
							...path,
							body: { closeDate: e.target.value || null },
						})
					}
				/>
			</DealField>
			<DealField label="Owner">
				<input
					className={fieldClass}
					placeholder="Assign an owner"
					value={owner}
					onChange={(e) => setOwner(e.target.value)}
					onBlur={() => {
						if (owner !== (a.ownerEmail ?? "")) {
							m.update.mutate({
								...path,
								body: { ownerEmail: owner || null },
							});
						}
					}}
				/>
			</DealField>
			<DealField label="Priority">
				<div className="flex gap-1 px-1.5 pt-1">
					{(["low", "medium", "high"] as const).map((p) => (
						<button
							key={p}
							type="button"
							onClick={() =>
								m.update.mutate({ ...path, body: { priority: p } })
							}
							className={cn(
								"rounded-md px-2 py-1 text-xs font-medium capitalize transition",
								a.priority === p
									? p === "high"
										? "bg-rose-500 text-white"
										: "bg-foreground text-background"
									: "text-muted-foreground hover:bg-muted",
							)}
						>
							{p}
						</button>
					))}
				</div>
			</DealField>
		</section>
	);
}

function Composer({
	id,
	people,
	m,
}: {
	id: string;
	people: Person[];
	m: Mutations;
}) {
	const [kind, setKind] = useState<ActivityKind>("note");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [due, setDue] = useState("");
	const [contact, setContact] = useState("");
	return (
		<form
			className="rounded-xl border border-border/70 bg-card p-3"
			onSubmit={(e) => {
				e.preventDefault();
				if (!subject.trim()) {
					return;
				}
				m.addActivity.mutate(
					{
						params: { path: { id } },
						body: {
							kind,
							subject,
							body: body || undefined,
							contactEmail: contact || undefined,
							dueAt:
								kind === "task" && due
									? new Date(due).toISOString()
									: undefined,
						},
					},
					{
						onSuccess: () => {
							setSubject("");
							setBody("");
							setDue("");
							toast.success(kind === "task" ? "Follow-up scheduled" : "Logged");
						},
					},
				);
			}}
		>
			<div className="flex flex-wrap gap-1">
				{(Object.keys(KIND_META) as ActivityKind[]).map((k) => {
					const Icon = KIND_META[k].icon;
					return (
						<button
							key={k}
							type="button"
							onClick={() => setKind(k)}
							className={cn(
								"inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
								kind === k
									? "bg-foreground text-background"
									: "text-muted-foreground hover:bg-muted",
							)}
						>
							<Icon className="h-3.5 w-3.5" />
							{KIND_META[k].label}
						</button>
					);
				})}
			</div>
			<Input
				className="mt-3"
				placeholder={
					kind === "task"
						? "What needs to happen next?"
						: kind === "call"
							? "Call summary"
							: "Subject"
				}
				value={subject}
				onChange={(e) => setSubject(e.target.value)}
			/>
			<Textarea
				className="mt-2 min-h-[64px]"
				placeholder="Details, objections, next steps…"
				value={body}
				onChange={(e) => setBody(e.target.value)}
			/>
			<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<select
						className="h-8 rounded-md border border-border bg-background px-2 text-xs"
						value={contact}
						onChange={(e) => setContact(e.target.value)}
					>
						<option value="">No contact</option>
						{people.map((p) => (
							<option key={p.email} value={p.email}>
								{p.name ?? p.email}
							</option>
						))}
					</select>
					{kind === "task" ? (
						<input
							type="datetime-local"
							className="h-8 rounded-md border border-border bg-background px-2 text-xs"
							value={due}
							onChange={(e) => setDue(e.target.value)}
							required
						/>
					) : null}
				</div>
				<Button size="sm" type="submit" disabled={m.addActivity.isPending}>
					{kind === "task" ? "Schedule" : "Log"}{" "}
					{KIND_META[kind].label.toLowerCase()}
				</Button>
			</div>
		</form>
	);
}

function ActivityFeed({
	detail,
	m,
}: {
	detail: CrmAccountDetail;
	m: Mutations;
}) {
	type Item =
		| { type: "activity"; at: string; a: Activity }
		| {
				type: "system";
				at: string;
				e: CrmAccountDetail["timeline"][number];
		  };
	const openTasks = detail.activities.filter(
		(a) => a.kind === "task" && !a.completedAt,
	);
	const items: Item[] = [
		...detail.activities
			.filter((a) => !(a.kind === "task" && !a.completedAt))
			.map((a) => ({
				type: "activity" as const,
				at: a.completedAt ?? a.createdAt,
				a,
			})),
		...detail.timeline.map((e) => ({ type: "system" as const, at: e.at, e })),
	].sort((x, y) => y.at.localeCompare(x.at));

	return (
		<div className="flex flex-col gap-5">
			{openTasks.length ? (
				<div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
					<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
						Open follow-ups
					</p>
					<ul className="flex flex-col gap-1.5">
						{openTasks.map((t) => {
							const overdue = t.dueAt && new Date(t.dueAt) < new Date();
							return (
								<li
									key={t.id}
									className="flex items-center gap-3 rounded-lg bg-card px-3 py-2"
								>
									<button
										type="button"
										aria-label="Mark done"
										onClick={() => {
											m.patchActivity.mutate({
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
										{t.contactEmail ? (
											<p className="truncate text-[11px] text-muted-foreground">
												with {t.contactEmail}
											</p>
										) : null}
									</div>
									<span
										className={cn(
											"shrink-0 text-xs tabular-nums",
											overdue
												? "font-semibold text-rose-600"
												: "text-muted-foreground",
										)}
									>
										{overdue ? "Overdue · " : ""}
										{relativeDays(t.dueAt)}
									</span>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
			<ol className="relative ml-2 border-l border-border/80">
				{items.map((item) => {
					if (item.type === "system") {
						return (
							<li
								key={`s-${item.at}-${item.e.title}`}
								className="relative pb-4 pl-6"
							>
								<span
									className={cn(
										"absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background",
										SYSTEM_TONE[item.e.kind],
									)}
								/>
								<p className="text-xs text-muted-foreground">
									<span className="font-medium text-foreground/80">
										{item.e.title}
									</span>
									<span className="ml-2">{shortDate(item.at)}</span>
								</p>
								{item.e.detail ? (
									<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
										{item.e.detail}
									</p>
								) : null}
							</li>
						);
					}
					const meta = KIND_META[item.a.kind];
					const Icon = meta.icon;
					return (
						<li key={item.a.id} className="group relative pb-5 pl-6">
							<span
								className={cn(
									"absolute -left-[11px] top-0 flex h-[22px] w-[22px] items-center justify-center rounded-full text-white ring-4 ring-background",
									meta.tone,
								)}
							>
								<Icon className="h-3 w-3" />
							</span>
							<div className="rounded-lg border border-border/70 bg-card px-3 py-2.5">
								<div className="flex items-start justify-between gap-2">
									<p className="text-sm font-medium">
										{item.a.kind === "task" ? (
											<Check className="mr-1 inline h-3.5 w-3.5 text-emerald-500" />
										) : null}
										{item.a.subject}
									</p>
									<button
										type="button"
										aria-label="Delete"
										onClick={() =>
											m.deleteActivity.mutate({
												params: { path: { activityId: item.a.id } },
											})
										}
										className="opacity-0 transition group-hover:opacity-100"
									>
										<Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-rose-600" />
									</button>
								</div>
								{item.a.body ? (
									<p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
										{item.a.body}
									</p>
								) : null}
								<p className="mt-1.5 text-[11px] text-muted-foreground">
									{meta.label} · {shortDate(item.at)}
									{item.a.contactEmail ? ` · with ${item.a.contactEmail}` : ""}
									{item.a.authorEmail ? ` · by ${item.a.authorEmail}` : ""}
								</p>
							</div>
						</li>
					);
				})}
			</ol>
		</div>
	);
}

function Fact({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="min-w-0">
			<dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</dt>
			<dd className="mt-0.5 truncate text-sm">{children}</dd>
		</div>
	);
}

function ContactDialog({
	accountId,
	person,
	open,
	onOpenChange,
	m,
}: {
	accountId: string;
	person: Person | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	m: Mutations;
}) {
	const [form, setForm] = useState({
		email: "",
		name: "",
		title: "",
		role: "",
		phone: "",
		linkedinUrl: "",
		notes: "",
	});
	useEffect(() => {
		if (open) {
			setForm({
				email: person?.email ?? "",
				name: person?.name ?? "",
				title: person?.title ?? "",
				role: person?.role ?? "",
				phone: person?.phone ?? "",
				linkedinUrl: person?.linkedinUrl ?? "",
				notes: person?.notes ?? "",
			});
		}
	}, [open, person]);
	const set =
		(k: keyof typeof form) =>
		(
			e: React.ChangeEvent<
				HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
			>,
		) =>
			setForm((f) => ({ ...f, [k]: e.target.value }));
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{person ? "Edit contact" : "Add contact"}</DialogTitle>
				</DialogHeader>
				<form
					className="grid grid-cols-2 gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						m.saveContact.mutate(
							{
								params: { path: { id: accountId } },
								body: {
									email: form.email,
									name: form.name || null,
									title: form.title || null,
									role: (form.role || null) as Person["role"],
									phone: form.phone || null,
									linkedinUrl: form.linkedinUrl || null,
									notes: form.notes || null,
								},
							},
							{
								onSuccess: () => {
									onOpenChange(false);
									toast.success("Contact saved");
								},
							},
						);
					}}
				>
					<div className="col-span-2 grid gap-1.5">
						<Label>Email</Label>
						<Input
							type="email"
							value={form.email}
							onChange={set("email")}
							disabled={!!person}
							required
						/>
					</div>
					<div className="grid gap-1.5">
						<Label>Name</Label>
						<Input value={form.name} onChange={set("name")} />
					</div>
					<div className="grid gap-1.5">
						<Label>Title</Label>
						<Input
							value={form.title}
							onChange={set("title")}
							placeholder="VP Engineering"
						/>
					</div>
					<div className="grid gap-1.5">
						<Label>Buying role</Label>
						<select
							className="h-9 rounded-md border border-border bg-background px-3 text-sm"
							value={form.role}
							onChange={set("role")}
						>
							<option value="">Unknown</option>
							{Object.entries(ROLE_LABELS).map(([v, l]) => (
								<option key={v} value={v}>
									{l}
								</option>
							))}
						</select>
					</div>
					<div className="grid gap-1.5">
						<Label>Phone</Label>
						<Input value={form.phone} onChange={set("phone")} />
					</div>
					<div className="col-span-2 grid gap-1.5">
						<Label>LinkedIn</Label>
						<Input
							value={form.linkedinUrl}
							onChange={set("linkedinUrl")}
							placeholder="https://linkedin.com/in/…"
						/>
					</div>
					<div className="col-span-2 grid gap-1.5">
						<Label>Notes</Label>
						<Textarea value={form.notes} onChange={set("notes")} />
					</div>
					<DialogFooter className="col-span-2">
						<Button type="submit" disabled={m.saveContact.isPending}>
							Save contact
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function PersonCard({
	person,
	onEdit,
}: {
	person: Person;
	onEdit: () => void;
}) {
	const u = person.user;
	return (
		<article className="rounded-xl border border-border/70 bg-card p-4">
			<div className="flex items-start gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-200 to-zinc-400 font-display text-sm font-bold text-zinc-800 dark:from-zinc-600 dark:to-zinc-800 dark:text-zinc-100">
					{initials(person.name ?? person.email)}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<p className="font-semibold">{person.name ?? person.email}</p>
						{person.role ? (
							<span className="rounded-full bg-foreground px-2 py-0.5 text-[10px] font-semibold text-background">
								{ROLE_LABELS[person.role]}
							</span>
						) : null}
					</div>
					<p className="text-xs text-muted-foreground">
						{person.title ?? "Title unknown"}
					</p>
					<div className="mt-1.5 flex flex-wrap gap-1">
						{person.sources.map((s) => (
							<span
								key={s}
								className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground"
							>
								{s === "lead"
									? "Reached out"
									: s === "member"
										? "Org member"
										: "Added by sales"}
							</span>
						))}
						{!person.corporateEmail ? (
							<span className="rounded border border-amber-500/40 px-1.5 py-px text-[10px] text-amber-700">
								Personal email
							</span>
						) : null}
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					onClick={onEdit}
				>
					<Pencil className="h-3.5 w-3.5" />
				</Button>
			</div>
			<dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
				<Fact label="Email">
					<a href={`mailto:${person.email}`} className="hover:underline">
						{person.email}
					</a>
				</Fact>
				<Fact label="Phone">
					{person.phone ? (
						<a
							href={`tel:${person.phone}`}
							className="inline-flex items-center gap-1 hover:underline"
						>
							<Phone className="h-3 w-3" />
							{person.phone}
						</a>
					) : (
						"—"
					)}
				</Fact>
				<Fact label="Platform account">
					{u ? (
						<span>
							Since {shortDate(u.createdAt)}
							{u.emailVerified ? "" : " · unverified"}
						</span>
					) : (
						<span className="text-muted-foreground">Not signed up</span>
					)}
				</Fact>
				<Fact label="Last seen">
					{u?.lastSeenAt
						? `${relativeDays(u.lastSeenAt)} · ${u.sessionCount} sessions`
						: "—"}
				</Fact>
				<Fact label="Device">
					{u?.device ? (
						<span className="inline-flex items-center gap-1">
							<Monitor className="h-3 w-3" />
							{u.device}
						</span>
					) : (
						"—"
					)}
				</Fact>
				<Fact label="Last IP">
					<span className="font-mono text-xs">{u?.lastIp ?? "—"}</span>
				</Fact>
				<Fact label="Reached out">
					{person.submissionCount
						? `${person.submissionCount}× · last ${shortDate(person.lastSubmissionAt)}`
						: "—"}
				</Fact>
				<Fact label="Profiles">
					<span className="flex items-center gap-2">
						{person.linkedinUrl ? (
							<a
								href={person.linkedinUrl}
								target="_blank"
								rel="noreferrer"
								aria-label="LinkedIn"
							>
								<Linkedin className="h-3.5 w-3.5" />
							</a>
						) : null}
						{u?.githubUsername ? (
							<a
								href={`https://github.com/${u.githubUsername}`}
								target="_blank"
								rel="noreferrer"
								aria-label="GitHub"
							>
								<Github className="h-3.5 w-3.5" />
							</a>
						) : null}
						{u?.xUsername ? (
							<span className="text-xs">@{u.xUsername}</span>
						) : null}
						{!person.linkedinUrl && !u?.githubUsername && !u?.xUsername
							? "—"
							: null}
					</span>
				</Fact>
			</dl>
			{person.memberships.length ? (
				<div className="mt-4 border-t border-dashed border-border/80 pt-3">
					<p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
						Organizations
					</p>
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						{person.memberships.map((mb) => (
							<Link
								key={mb.orgId}
								href={`/organizations/${mb.orgId}`}
								className="rounded-md bg-muted px-2 py-1 text-[11px] hover:bg-muted/70"
							>
								{mb.orgName}
								<span className="text-muted-foreground">
									{" "}
									· {mb.role} · {mb.plan}
								</span>
							</Link>
						))}
					</div>
				</div>
			) : null}
			{person.notes ? (
				<p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
					{person.notes}
				</p>
			) : null}
		</article>
	);
}

function UsagePanel({ detail }: { detail: CrmAccountDetail }) {
	const a = detail.account;
	if (detail.orgs.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
				No platform organization yet. Usage appears here as soon as someone from{" "}
				{a.domain ?? "this company"} signs up.
			</div>
		);
	}
	const pct = trendPct(a.spend30d, a.spendPrev30d);
	return (
		<div className="flex flex-col gap-4">
			<div className="rounded-xl border border-border/70 bg-card p-4">
				<div className="flex flex-wrap items-end justify-between gap-2">
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
							Gateway spend · last 60 days
						</p>
						<p className="mt-1 font-display text-3xl font-semibold tabular-nums">
							{money(a.spend30d, false)}
							<span className="ml-2 text-sm font-normal text-muted-foreground">
								last 30d
							</span>
						</p>
					</div>
					<p
						className={cn(
							"text-sm font-medium",
							pct === null || pct >= 0 ? "text-emerald-600" : "text-rose-600",
						)}
					>
						{pct === null
							? "First month of spend"
							: `${pct > 0 ? "+" : ""}${pct}% vs prior 30d`}
						<span className="ml-2 font-normal text-muted-foreground">
							{a.requests30d.toLocaleString()} requests
						</span>
					</p>
				</div>
				<div className="mt-4 h-56">
					<ResponsiveContainer width="100%" height="100%">
						<AreaChart data={detail.usage.daily}>
							<defs>
								<linearGradient id="crmSpend" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
									<stop offset="100%" stopColor="#10b981" stopOpacity={0} />
								</linearGradient>
							</defs>
							<CartesianGrid
								strokeDasharray="3 3"
								vertical={false}
								stroke="currentColor"
								className="text-border"
							/>
							<XAxis
								dataKey="date"
								tickFormatter={(d: string) => d.slice(5)}
								tick={{ fontSize: 10 }}
								interval={9}
								stroke="currentColor"
								className="text-muted-foreground"
							/>
							<YAxis
								tickFormatter={(v: number) => `$${Math.round(v)}`}
								tick={{ fontSize: 10 }}
								width={48}
								stroke="currentColor"
								className="text-muted-foreground"
							/>
							<Tooltip
								formatter={(v: number) => [money(v, false), "Spend"]}
								contentStyle={{ fontSize: 12, borderRadius: 8 }}
							/>
							<Area
								type="monotone"
								dataKey="cost"
								stroke="#10b981"
								strokeWidth={2}
								fill="url(#crmSpend)"
							/>
						</AreaChart>
					</ResponsiveContainer>
				</div>
			</div>
			<div className="rounded-xl border border-border/70 bg-card">
				<p className="border-b border-border/70 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
					Top models · 30d
				</p>
				<ul>
					{detail.usage.topModels.map((mdl) => {
						const max = detail.usage.topModels[0]?.requests ?? 1;
						return (
							<li
								key={`${mdl.provider}/${mdl.model}`}
								className="relative px-4 py-2.5 text-sm"
							>
								<span
									className="absolute inset-y-1 left-0 rounded-r bg-emerald-500/10"
									style={{ width: `${(mdl.requests / max) * 100}%` }}
								/>
								<span className="relative flex justify-between gap-3">
									<span className="truncate font-mono text-xs">
										{mdl.model}
									</span>
									<span className="shrink-0 font-mono text-xs text-muted-foreground">
										{mdl.requests.toLocaleString()} req ·{" "}
										{money(mdl.cost, false)}
									</span>
								</span>
							</li>
						);
					})}
					{detail.usage.topModels.length === 0 ? (
						<li className="px-4 py-6 text-center text-sm text-muted-foreground">
							No traffic in the last 30 days.
						</li>
					) : null}
				</ul>
			</div>
		</div>
	);
}

function InboundPanel({ detail }: { detail: CrmAccountDetail }) {
	if (detail.leads.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
				Nobody from this company has used the enterprise contact form.
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			{detail.leads.map((l) => (
				<article
					key={l.id}
					className="rounded-xl border border-border/70 bg-card p-4"
				>
					<div className="flex flex-wrap items-start justify-between gap-2">
						<div>
							<p className="font-semibold">{l.name}</p>
							<p className="text-xs text-muted-foreground">{l.email}</p>
						</div>
						<Button variant="outline" size="sm" asChild>
							<Link href={`/contact-submissions/${l.id}`}>
								Reply
								<ExternalLink className="h-3.5 w-3.5" />
							</Link>
						</Button>
					</div>
					<blockquote className="mt-3 border-l-2 border-sky-500 pl-3 text-sm leading-relaxed">
						{l.message}
					</blockquote>
					<dl className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
						<Fact label="Submitted">{shortDate(l.createdAt)}</Fact>
						<Fact label="Country">{l.country}</Fact>
						<Fact label="Company size">{l.size}</Fact>
						<Fact label="Deployment">
							{l.deployment === "self_host"
								? "Self-hosted"
								: l.deployment === "cloud"
									? "Managed cloud"
									: "Not sure"}
						</Fact>
						<Fact label="Device · IP">
							<span className="text-xs">
								{l.device ?? "—"} ·{" "}
								<span className="font-mono">{l.ipAddress ?? "—"}</span>
							</span>
						</Fact>
					</dl>
				</article>
			))}
		</div>
	);
}

function ProfilePanel({
	detail,
	m,
}: {
	detail: CrmAccountDetail;
	m: Mutations;
}) {
	const p = detail.profile;
	const initial = {
		displayName: p.displayName ?? "",
		website: p.website ?? "",
		industry: p.industry ?? "",
		employeeCount: p.employeeCount ?? "",
		headquarters: p.headquarters ?? "",
		linkedinUrl: p.linkedinUrl ?? "",
		useCase: p.useCase ?? "",
		competitors: p.competitors ?? "",
		tags: detail.account.tags.join(", "),
		notes: p.notes ?? "",
		lostReason: p.lostReason ?? "",
	};
	const [form, setForm] = useState(initial);
	const set =
		(k: keyof typeof form) =>
		(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
			setForm((f) => ({ ...f, [k]: e.target.value }));
	const field = (k: keyof typeof form, label: string, placeholder?: string) => (
		<div className="grid gap-1.5">
			<Label className="text-xs">{label}</Label>
			<Input value={form[k]} onChange={set(k)} placeholder={placeholder} />
		</div>
	);
	return (
		<form
			className="grid gap-4 rounded-xl border border-border/70 bg-card p-4 md:grid-cols-2"
			onSubmit={(e) => {
				e.preventDefault();
				const { tags, ...rest } = form;
				m.update.mutate(
					{
						params: { path: { id: detail.account.id } },
						body: {
							...Object.fromEntries(
								Object.entries(rest).map(([k, v]) => [k, v.trim() || null]),
							),
							tags: tags
								.split(",")
								.map((t) => t.trim().toLowerCase())
								.filter(Boolean),
						},
					},
					{ onSuccess: () => toast.success("Company profile saved") },
				);
			}}
		>
			{field("displayName", "Display name", detail.account.name)}
			{field("website", "Website", "https://")}
			{field("industry", "Industry", "Financial services")}
			{field("employeeCount", "Employees", "201-500")}
			{field("headquarters", "Headquarters", "London, UK")}
			{field("linkedinUrl", "LinkedIn", "https://linkedin.com/company/…")}
			{field("useCase", "Use case", "What they want the gateway for")}
			{field(
				"competitors",
				"Competing / incumbent",
				"Portkey, LiteLLM, in-house…",
			)}
			<div className="md:col-span-2">
				{field("tags", "Tags (comma separated)", "self-host, sso")}
			</div>
			<div className="grid gap-1.5 md:col-span-2">
				<Label className="text-xs">Account notes</Label>
				<Textarea
					value={form.notes}
					onChange={set("notes")}
					className="min-h-[96px]"
				/>
			</div>
			{detail.account.stage === "lost" || detail.account.stage === "churned" ? (
				<div className="md:col-span-2">
					{field("lostReason", "Why we lost it")}
				</div>
			) : null}
			<div className="md:col-span-2">
				<Button type="submit" disabled={m.update.isPending}>
					Save profile
				</Button>
			</div>
		</form>
	);
}

function SideCard({
	title,
	icon: Icon,
	children,
}: {
	title: string;
	icon: typeof Mail;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-xl border border-border/70 bg-card p-4">
			<h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
				<Icon className="h-3.5 w-3.5" />
				{title}
			</h3>
			{children}
		</section>
	);
}

export function CrmAccountView({ id }: { id: string }) {
	const $api = useApi();
	const m = useAccountMutations(id);
	const [contactOpen, setContactOpen] = useState(false);
	const [editing, setEditing] = useState<Person | null>(null);
	const { data, isLoading, error } = $api.useQuery(
		"get",
		"/admin/crm/accounts/{id}",
		{ params: { path: { id } } },
	);

	if (isLoading) {
		return (
			<div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-8 md:px-8">
				<Skeleton className="h-10 w-72" />
				<Skeleton className="h-20 w-full" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}
	if (error || !data) {
		return (
			<div className="px-8 py-16 text-center text-sm text-muted-foreground">
				Account not found.{" "}
				<Link href="/crm" className="underline">
					Back to accounts
				</Link>
			</div>
		);
	}

	const a = data.account;
	const nextDates = [
		{ label: "First seen", at: a.firstSeenAt },
		{ label: "Trial ends", at: a.trialEndsAt },
		{ label: "Contract renews", at: a.renewalAt },
		{ label: "Expected close", at: a.closeDate },
		{ label: "Last sales touch", at: a.lastTouchAt },
		{ label: "Last gateway traffic", at: a.lastUsageAt },
	].filter((d) => d.at);

	return (
		<div className="mx-auto flex w-full max-w-[1600px] flex-col gap-5 px-4 py-8 md:px-8">
			<Link
				href="/crm"
				className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				All accounts
			</Link>

			<header className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
				<div className="flex items-center gap-4">
					<span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-foreground font-display text-xl font-bold text-background">
						{initials(a.name)}
					</span>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="font-display text-3xl font-bold tracking-tight">
								{a.name}
							</h1>
							<SegmentChip segment={a.segment} />
						</div>
						<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
							{a.domain ? (
								<a
									href={data.profile.website ?? `https://${a.domain}`}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 font-mono hover:text-foreground"
								>
									<Globe className="h-3 w-3" />
									{a.domain}
								</a>
							) : null}
							{data.profile.industry ? (
								<span>{data.profile.industry}</span>
							) : null}
							{data.profile.employeeCount ? (
								<span>{data.profile.employeeCount} employees</span>
							) : null}
							{data.profile.headquarters ? (
								<span>{data.profile.headquarters}</span>
							) : null}
							{a.tags.map((t) => (
								<span
									key={t}
									className="rounded bg-muted px-1.5 py-px font-mono text-[10px]"
								>
									#{t}
								</span>
							))}
						</div>
					</div>
				</div>
				<div className="flex items-center gap-4 rounded-xl border border-border/70 bg-card px-4 py-3">
					<ScoreRing score={a.score.score} label={a.score.label} size={60} />
					<div className="max-w-xs">
						<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							{a.scoreKind === "lead" ? "Lead fit" : "Account health"} ·{" "}
							<span
								className={cn(
									a.score.label === "healthy"
										? "text-emerald-600"
										: a.score.label === "watch"
											? "text-amber-600"
											: "text-rose-600",
								)}
							>
								{a.score.label.replace("_", " ")}
							</span>
						</p>
						<ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
							{a.score.reasons.slice(0, 4).map((r) => (
								<li key={r}>· {r}</li>
							))}
						</ul>
					</div>
				</div>
			</header>

			<DealStrip detail={data} m={m} />

			<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
				<Tabs defaultValue="activity" className="min-w-0">
					<TabsList>
						<TabsTrigger value="activity">Activity</TabsTrigger>
						<TabsTrigger value="people">
							People · {data.people.length}
						</TabsTrigger>
						<TabsTrigger value="usage">Usage</TabsTrigger>
						<TabsTrigger value="inbound">
							Inbound · {data.leads.length}
						</TabsTrigger>
						<TabsTrigger value="profile">Company profile</TabsTrigger>
					</TabsList>
					<TabsContent value="activity" className="mt-4 flex flex-col gap-5">
						<Composer id={a.id} people={data.people} m={m} />
						<ActivityFeed detail={data} m={m} />
					</TabsContent>
					<TabsContent value="people" className="mt-4">
						<div className="mb-3 flex justify-end">
							<Button
								size="sm"
								variant="outline"
								onClick={() => {
									setEditing(null);
									setContactOpen(true);
								}}
							>
								<Plus className="h-4 w-4" />
								Add contact
							</Button>
						</div>
						<div className="grid gap-3 lg:grid-cols-2">
							{data.people.map((p) => (
								<PersonCard
									key={p.email}
									person={p}
									onEdit={() => {
										setEditing(p);
										setContactOpen(true);
									}}
								/>
							))}
						</div>
					</TabsContent>
					<TabsContent value="usage" className="mt-4">
						<UsagePanel detail={data} />
					</TabsContent>
					<TabsContent value="inbound" className="mt-4">
						<InboundPanel detail={data} />
					</TabsContent>
					<TabsContent value="profile" className="mt-4">
						<ProfilePanel
							key={JSON.stringify(data.profile)}
							detail={data}
							m={m}
						/>
					</TabsContent>
				</Tabs>

				<aside className="flex flex-col gap-4">
					<SideCard title="Key dates" icon={CalendarClock}>
						<ul className="space-y-2">
							{nextDates.map((d) => (
								<li
									key={d.label}
									className="flex items-center justify-between text-sm"
								>
									<span className="text-muted-foreground">{d.label}</span>
									<span className="tabular-nums">
										{shortDate(d.at)}{" "}
										<span className="text-xs text-muted-foreground">
											({relativeDays(d.at)})
										</span>
									</span>
								</li>
							))}
						</ul>
					</SideCard>
					<SideCard title="Platform organizations" icon={Building2}>
						{data.orgs.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								Not on the platform yet.
							</p>
						) : (
							<div className="flex flex-col gap-3">
								{data.orgs.map((o) => (
									<Link
										key={o.id}
										href={`/organizations/${o.id}`}
										className="block rounded-lg border border-border/70 p-3 transition hover:border-foreground/20"
									>
										<div className="flex items-center justify-between">
											<p className="text-sm font-semibold">{o.name}</p>
											<span
												className={cn(
													"rounded px-1.5 py-px text-[10px] font-semibold uppercase",
													o.plan === "enterprise"
														? "bg-emerald-500/15 text-emerald-700"
														: "bg-muted text-muted-foreground",
												)}
											>
												{o.isTrialActive ? "trial" : o.plan}
											</span>
										</div>
										<dl className="mt-2 grid grid-cols-3 gap-2 text-center">
											{[
												["Members", o.memberCount],
												["Projects", o.projectCount],
												["API keys", o.apiKeyCount],
												["Spend 30d", money(o.spend30d)],
												["Credits", money(o.credits)],
												["Seats", o.seats ?? "default"],
											].map(([label, value]) => (
												<div
													key={label as string}
													className="rounded-md bg-muted/50 px-1 py-1.5"
												>
													<dd className="font-mono text-xs font-semibold">
														{value}
													</dd>
													<dt className="text-[9px] uppercase tracking-wider text-muted-foreground">
														{label}
													</dt>
												</div>
											))}
										</dl>
										<p className="mt-2 truncate text-[11px] text-muted-foreground">
											Billing: {o.billingCompany ?? "—"} · {o.billingEmail}
											{o.ssoAutoJoinDomain
												? ` · SSO @${o.ssoAutoJoinDomain}`
												: ""}
										</p>
									</Link>
								))}
							</div>
						)}
					</SideCard>
					<SideCard title="Revenue" icon={CircleDollarSign}>
						<div className="grid grid-cols-2 gap-2">
							<div>
								<p className="font-display text-xl font-semibold tabular-nums">
									{money(data.revenue.lifetime)}
								</p>
								<p className="text-[11px] text-muted-foreground">Lifetime</p>
							</div>
							<div>
								<p className="font-display text-xl font-semibold tabular-nums">
									{money(data.revenue.last90d)}
								</p>
								<p className="text-[11px] text-muted-foreground">
									Last 90 days
								</p>
							</div>
						</div>
						<ul className="mt-3 space-y-1.5">
							{data.revenue.transactions.slice(0, 5).map((t) => (
								<li key={t.id} className="flex justify-between gap-2 text-xs">
									<span className="truncate text-muted-foreground">
										{shortDate(t.createdAt)} · {t.type.replaceAll("_", " ")}
									</span>
									<span className="font-mono">{money(t.amount, false)}</span>
								</li>
							))}
						</ul>
					</SideCard>
					<SideCard title="Buying committee" icon={Users}>
						<ul className="space-y-2">
							{data.people.slice(0, 5).map((p) => (
								<li key={p.email} className="flex items-center gap-2 text-sm">
									<span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
										{initials(p.name ?? p.email)}
									</span>
									<span className="min-w-0 flex-1 truncate">
										{p.name ?? p.email}
									</span>
									<span className="text-[11px] text-muted-foreground">
										{p.role
											? ROLE_LABELS[p.role]
											: p.sources.includes("lead")
												? "Reached out"
												: "Member"}
									</span>
								</li>
							))}
						</ul>
						{data.leads[0] ? (
							<p className="mt-3 flex gap-2 rounded-md bg-sky-500/5 p-2 text-xs text-muted-foreground">
								<MessageSquareQuote className="h-4 w-4 shrink-0 text-sky-500" />
								<span className="line-clamp-3">{data.leads[0].message}</span>
							</p>
						) : null}
					</SideCard>
				</aside>
			</div>

			<ContactDialog
				accountId={a.id}
				person={editing}
				open={contactOpen}
				onOpenChange={setContactOpen}
				m={m}
			/>
		</div>
	);
}
