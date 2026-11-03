"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Building2,
	CalendarDays,
	ExternalLink,
	Github,
	Globe,
	Linkedin,
	Mail,
	MessageSquareQuote,
	Phone,
	Plus,
	Sparkles,
	User,
	Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { type CrmCall, AttendeeChips, timeRange } from "./crm-calls";
import {
	type CrmAccountDetail,
	accountHref,
	initials,
	money,
	relativeDays,
	safeExternalUrl,
	ScoreRing,
	SegmentChip,
	shortDate,
	stageLabel,
} from "./crm-meta";

import type { paths } from "@/lib/api/v1";

type ResearchNote =
	paths["/admin/crm/accounts/{id}/research"]["get"]["responses"]["200"]["content"]["application/json"]["notes"][number];
type Person = CrmAccountDetail["people"][number];

const ROLE_LABELS: Record<NonNullable<Person["role"]>, string> = {
	champion: "Champion",
	decision_maker: "Decision maker",
	economic_buyer: "Economic buyer",
	technical: "Technical evaluator",
	procurement: "Procurement",
	user: "End user",
	blocker: "Blocker",
};

function whenLabel(iso: string) {
	return new Date(iso).toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
	});
}

function Card({
	title,
	icon: Icon,
	action,
	children,
	className,
}: {
	title: string;
	icon: typeof Mail;
	action?: React.ReactNode;
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<section
			className={cn(
				"rounded-xl border border-border/70 bg-card p-4",
				className,
			)}
		>
			<div className="mb-3 flex items-center justify-between gap-2">
				<h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					<Icon className="h-3.5 w-3.5" />
					{title}
				</h3>
				{action}
			</div>
			{children}
		</section>
	);
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3 text-sm">
			<span className="shrink-0 text-muted-foreground">{label}</span>
			<span className="truncate text-right font-medium">{value}</span>
		</div>
	);
}

function CompanyCard({ detail }: { detail: CrmAccountDetail }) {
	const a = detail.account;
	const p = detail.profile;
	const website = safeExternalUrl(p.website);
	return (
		<Card
			title="Company"
			icon={Building2}
			action={
				<Button size="sm" variant="ghost" asChild>
					<Link href={accountHref(a.id)}>
						Open account
						<ExternalLink className="h-3.5 w-3.5" />
					</Link>
				</Button>
			}
		>
			<div className="flex items-start gap-3">
				<span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-foreground font-display text-lg font-bold text-background">
					{initials(a.name)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="flex flex-wrap items-center gap-2 font-display text-xl font-semibold">
						{a.name}
						<SegmentChip segment={a.segment} />
					</p>
					<p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
						{website ? (
							<a
								href={website}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 font-mono hover:text-foreground"
							>
								<Globe className="h-3 w-3" />
								{a.domain ?? website}
							</a>
						) : null}
						{p.industry ? <span>{p.industry}</span> : null}
						{p.employeeCount ? <span>{p.employeeCount} employees</span> : null}
						{p.headquarters ? <span>{p.headquarters}</span> : null}
						{p.linkedinUrl && safeExternalUrl(p.linkedinUrl) ? (
							<a
								href={safeExternalUrl(p.linkedinUrl)!}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 hover:text-foreground"
							>
								<Linkedin className="h-3 w-3" />
								LinkedIn
							</a>
						) : null}
					</p>
				</div>
				<ScoreRing score={a.score.score} label={a.score.label} size={52} />
			</div>
			<div className="mt-4 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
				<Fact label="Stage" value={stageLabel(a.stage)} />
				<Fact label="Owner" value={a.ownerEmail ?? "unassigned"} />
				<Fact label="Deal value" value={money(a.dealValue)} />
				<Fact
					label="Expected close"
					value={a.closeDate ? shortDate(a.closeDate) : "—"}
				/>
				<Fact
					label="Gateway spend 30d"
					value={`${money(a.spend30d)} · ${a.requests30d.toLocaleString("en-US")} req`}
				/>
				<Fact label="Lifetime revenue" value={money(detail.revenue.lifetime)} />
				<Fact
					label="Last sales touch"
					value={a.lastTouchAt ? relativeDays(a.lastTouchAt) : "never"}
				/>
				<Fact
					label="Last gateway traffic"
					value={a.lastUsageAt ? relativeDays(a.lastUsageAt) : "none"}
				/>
				{a.trialEndsAt ? (
					<Fact label="Trial ends" value={relativeDays(a.trialEndsAt)} />
				) : null}
				{a.renewalAt ? (
					<Fact label="Contract renews" value={relativeDays(a.renewalAt)} />
				) : null}
				<Fact
					label="Open follow-ups"
					value={`${a.openTasks}${a.overdueTasks ? ` (${a.overdueTasks} overdue)` : ""}`}
				/>
				<Fact
					label="Platform orgs"
					value={
						detail.orgs.length
							? detail.orgs
									.map(
										(o) => `${o.name} (${o.isTrialActive ? "trial" : o.plan})`,
									)
									.join(", ")
							: "none"
					}
				/>
			</div>
			{a.score.reasons.length ? (
				<ul className="mt-3 flex flex-wrap gap-1.5">
					{a.score.reasons.slice(0, 5).map((r) => (
						<li
							key={r}
							className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
						>
							{r}
						</li>
					))}
				</ul>
			) : null}
			{p.useCase || p.competitors || p.notes ? (
				<dl className="mt-4 space-y-2 text-sm">
					{p.useCase ? (
						<div>
							<dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
								Use case
							</dt>
							<dd className="whitespace-pre-wrap">{p.useCase}</dd>
						</div>
					) : null}
					{p.competitors ? (
						<div>
							<dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
								Competitors
							</dt>
							<dd>{p.competitors}</dd>
						</div>
					) : null}
					{p.notes ? (
						<div>
							<dt className="text-[11px] uppercase tracking-wider text-muted-foreground">
								Notes
							</dt>
							<dd className="whitespace-pre-wrap">{p.notes}</dd>
						</div>
					) : null}
				</dl>
			) : null}
			{detail.leads[0] ? (
				<p className="mt-3 flex gap-2 rounded-md bg-sky-500/5 p-2 text-xs text-muted-foreground">
					<MessageSquareQuote className="h-4 w-4 shrink-0 text-sky-500" />
					<span>
						<span className="font-medium text-foreground/80">
							{detail.leads[0].name} wrote via the enterprise form (
							{shortDate(detail.leads[0].createdAt)}):
						</span>{" "}
						{detail.leads[0].message}
					</span>
				</p>
			) : null}
		</Card>
	);
}

function PersonCard({
	attendee,
	person,
	onResearch,
	researching,
}: {
	attendee: CrmCall["attendees"][number];
	person: Person | undefined;
	onResearch: () => void;
	researching: boolean;
}) {
	const name = person?.name ?? attendee.name ?? attendee.email;
	const linkedin = safeExternalUrl(person?.linkedinUrl);
	return (
		<Card
			title="Person"
			icon={User}
			action={
				<Button
					size="sm"
					variant="outline"
					onClick={onResearch}
					disabled={researching}
				>
					<Sparkles className="h-3.5 w-3.5" />
					{researching ? "Researching…" : "Research with AI"}
				</Button>
			}
		>
			<div className="flex items-start gap-3">
				<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold">
					{initials(name)}
				</span>
				<div className="min-w-0 flex-1">
					<p className="font-semibold">{name}</p>
					<p className="text-xs text-muted-foreground">
						{person?.title ? `${person.title} · ` : ""}
						{person?.role
							? ROLE_LABELS[person.role]
							: person?.sources.includes("lead")
								? "Reached out via the enterprise form"
								: person?.sources.includes("member")
									? "Platform member"
									: "Not in the CRM yet"}
					</p>
					<p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
						<a
							href={`mailto:${attendee.email}`}
							className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-foreground"
						>
							<Mail className="h-3 w-3" />
							{attendee.email}
						</a>
						{person?.phone ? (
							<span className="inline-flex items-center gap-1 text-muted-foreground">
								<Phone className="h-3 w-3" />
								{person.phone}
							</span>
						) : null}
						{linkedin ? (
							<a
								href={linkedin}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
							>
								<Linkedin className="h-3 w-3" />
								LinkedIn
							</a>
						) : null}
						{person?.user?.githubUsername ? (
							<a
								href={`https://github.com/${encodeURIComponent(person.user.githubUsername)}`}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
							>
								<Github className="h-3 w-3" />
								{person.user.githubUsername}
							</a>
						) : null}
					</p>
				</div>
				<span
					className={cn(
						"shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
						attendee.responseStatus === "accepted"
							? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
							: attendee.responseStatus === "declined"
								? "bg-rose-500/15 text-rose-700"
								: "bg-muted text-muted-foreground",
					)}
				>
					{attendee.responseStatus === "needsAction"
						? "no reply"
						: attendee.responseStatus}
				</span>
			</div>
			{person ? (
				<div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
					{person.user ? (
						<>
							<Fact
								label="Signed up"
								value={`${shortDate(person.user.createdAt)}${person.user.emailVerified ? "" : " (unverified)"}`}
							/>
							<Fact
								label="Last seen"
								value={
									person.user.lastSeenAt
										? `${relativeDays(person.user.lastSeenAt)}${person.user.device ? ` · ${person.user.device}` : ""}`
										: "never"
								}
							/>
						</>
					) : null}
					{person.memberships.map((m) => (
						<Fact
							key={m.orgId}
							label={m.orgName}
							value={`${m.role} · ${m.plan}`}
						/>
					))}
					{person.submissionCount ? (
						<Fact
							label="Form submissions"
							value={`${person.submissionCount} · last ${relativeDays(person.lastSubmissionAt)}`}
						/>
					) : null}
				</div>
			) : null}
			{person?.notes ? (
				<p className="mt-3 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-xs">
					{person.notes}
				</p>
			) : null}
		</Card>
	);
}

function ResearchNoteView({ note }: { note: ResearchNote }) {
	const [open, setOpen] = useState(true);
	return (
		<article className="rounded-lg border border-border/70 bg-background p-3">
			<button
				type="button"
				className="flex w-full items-baseline justify-between gap-2 text-left"
				onClick={() => setOpen((v) => !v)}
			>
				<span className="text-sm font-semibold">
					{note.subject.replace(/^AI research: /, "")}
				</span>
				<span className="shrink-0 text-[11px] text-muted-foreground">
					{shortDate(note.createdAt)} · {note.authorEmail ?? "—"}
				</span>
			</button>
			{open ? (
				<pre className="mt-2 whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
					{note.body}
				</pre>
			) : null}
		</article>
	);
}

export function CrmCallBrief({
	integrationId,
	eventId,
}: {
	integrationId: string;
	eventId: string;
}) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const router = useRouter();
	const [question, setQuestion] = useState("");
	const [running, setRunning] = useState<string | null>(null);

	const callQuery = $api.useQuery(
		"get",
		"/admin/crm/calls/{integrationId}/{eventId}",
		{ params: { path: { integrationId, eventId } } },
	);
	const call = callQuery.data?.call;
	const accountId = call?.account?.id ?? "";
	const detailQuery = $api.useQuery(
		"get",
		"/admin/crm/accounts/{id}",
		{ params: { path: { id: accountId } } },
		{ enabled: !!accountId },
	);
	const mailQuery = $api.useQuery(
		"get",
		"/admin/crm/accounts/{id}/mail",
		{ params: { path: { id: accountId } } },
		{ enabled: !!accountId, staleTime: 60_000 },
	);
	const researchQuery = $api.useQuery(
		"get",
		"/admin/crm/accounts/{id}/research",
		{ params: { path: { id: accountId } } },
		{ enabled: !!accountId },
	);
	const statusQuery = $api.useQuery("get", "/admin/crm/research/status");
	const research = $api.useMutation("post", "/admin/crm/research", {
		meta: { inlineError: true },
	});
	const createAccount = $api.useMutation("post", "/admin/crm/accounts", {
		onSuccess: () => {
			toast.success("Account created");
			void queryClient.invalidateQueries({
				queryKey: $api.queryOptions(
					"get",
					"/admin/crm/calls/{integrationId}/{eventId}",
					{ params: { path: { integrationId, eventId } } },
				).queryKey,
			});
			router.refresh();
		},
		meta: { errorMessage: "Could not create the account" },
	});

	const runResearch = (kind: "company" | "person", email?: string) => {
		if (!accountId) {
			return;
		}
		const key = email ?? "company";
		setRunning(key);
		research.mutate(
			{
				body: {
					accountId,
					kind,
					email,
					question: question.trim() || undefined,
				},
			},
			{
				onSuccess: () => {
					toast.success("Research saved to the account");
					setQuestion("");
					void queryClient.invalidateQueries({
						queryKey: $api.queryOptions(
							"get",
							"/admin/crm/accounts/{id}/research",
							{ params: { path: { id: accountId } } },
						).queryKey,
					});
					void queryClient.invalidateQueries({
						queryKey: $api.queryOptions("get", "/admin/crm/accounts/{id}", {
							params: { path: { id: accountId } },
						}).queryKey,
					});
				},
				onError: (err) =>
					toast.error(
						(err as { message?: string })?.message ?? "Research failed",
					),
				onSettled: () => setRunning(null),
			},
		);
	};

	if (callQuery.isLoading) {
		return (
			<div className="mx-auto flex w-full max-w-[1400px] flex-col gap-4 px-4 py-8 md:px-8">
				<Skeleton className="h-10 w-72" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}
	if (callQuery.error || !call) {
		return (
			<div className="px-8 py-16 text-center text-sm text-muted-foreground">
				Calendar event not found.{" "}
				<Link href="/crm/calls" className="underline">
					Back to calls
				</Link>
			</div>
		);
	}

	const outside = call.attendees.filter((a) => !a.internal);
	const detail = detailQuery.data;
	const attendeeEmails = new Set(outside.map((a) => a.email));
	const threads = (mailQuery.data?.threads ?? []).filter((t) =>
		t.participants.some((p) => attendeeEmails.has(p.email)),
	);
	const recentActivities = (detail?.activities ?? [])
		.filter((a) => !a.subject.startsWith("AI research: "))
		.slice(0, 8);
	const aiAvailable = statusQuery.data?.available ?? false;

	return (
		<div className="mx-auto flex w-full max-w-[1400px] flex-col gap-5 px-4 py-8 md:px-8">
			<Link
				href="/crm/calls"
				className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft className="h-3.5 w-3.5" />
				Upcoming calls
			</Link>

			<header className="flex flex-col justify-between gap-4 rounded-xl border border-border/70 bg-card p-5 md:flex-row md:items-center">
				<div className="min-w-0">
					<p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
						Call briefing
					</p>
					<h1 className="mt-1 font-display text-3xl font-bold tracking-tight">
						{call.summary}
					</h1>
					<p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<CalendarDays className="h-4 w-4" />
							{whenLabel(call.startAt)} · {timeRange(call)} (
							{relativeDays(call.startAt)})
						</span>
						<span>on {call.calendar}</span>
						{call.location && !call.joinUrl ? (
							<span>{call.location}</span>
						) : null}
					</p>
					<div className="mt-2">
						<AttendeeChips attendees={call.attendees} limit={8} />
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{call.htmlLink ? (
						<Button variant="ghost" size="sm" asChild>
							<a href={call.htmlLink} target="_blank" rel="noreferrer">
								Open in Calendar
								<ExternalLink className="h-3.5 w-3.5" />
							</a>
						</Button>
					) : null}
					{call.joinUrl ? (
						<Button asChild>
							<a href={call.joinUrl} target="_blank" rel="noreferrer">
								<Video className="h-4 w-4" />
								Join call
							</a>
						</Button>
					) : null}
				</div>
			</header>

			{call.description ? (
				<p className="whitespace-pre-wrap rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">
					{call.description}
				</p>
			) : null}

			{!call.account ? (
				<div className="rounded-xl border border-dashed border-border p-8 text-center">
					<Building2 className="mx-auto h-8 w-8 text-muted-foreground" />
					<p className="mt-3 text-sm font-medium">
						{call.suggestedDomain
							? `${call.suggestedDomain} is not in the CRM yet`
							: "No company could be matched to these attendees"}
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						Add it as a prospect to get the briefing, log the call and run
						research.
					</p>
					{call.suggestedDomain ? (
						<Button
							size="sm"
							className="mt-4"
							disabled={createAccount.isPending}
							onClick={() =>
								createAccount.mutate({
									body: {
										domain: call.suggestedDomain!,
										name: call
											.suggestedDomain!.split(".")[0]!
											.replace(/[-_]/g, " ")
											.replace(/\b\w/g, (ch) => ch.toUpperCase()),
									},
								})
							}
						>
							<Plus className="h-4 w-4" />
							Add {call.suggestedDomain} as a prospect
						</Button>
					) : null}
				</div>
			) : null}

			{call.account ? (
				<div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
					<div className="flex min-w-0 flex-col gap-5">
						{detail ? (
							<CompanyCard detail={detail} />
						) : (
							<Skeleton className="h-64 w-full rounded-xl" />
						)}
						{outside.map((a) => (
							<PersonCard
								key={a.email}
								attendee={a}
								person={detail?.people.find((p) => p.email === a.email)}
								onResearch={() => runResearch("person", a.email)}
								researching={running === a.email}
							/>
						))}
						<Card title="Recent email with them" icon={Mail}>
							{mailQuery.isLoading ? (
								<Skeleton className="h-20 w-full" />
							) : threads.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{mailQuery.data?.mailboxes.length
										? "No email threads with these attendees."
										: "No mailbox connected."}
								</p>
							) : (
								<ul className="divide-y divide-border/70">
									{threads.slice(0, 6).map((t) => (
										<li
											key={`${t.integrationId}:${t.threadId}`}
											className="py-2"
										>
											<p className="flex items-baseline justify-between gap-2 text-sm">
												<span className="truncate font-medium">
													{t.subject}
												</span>
												<span className="shrink-0 text-[11px] text-muted-foreground">
													{shortDate(t.lastAt)} · {t.messageCount}
												</span>
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{t.lastFrom?.name ?? t.lastFrom?.email} — {t.snippet}
											</p>
										</li>
									))}
								</ul>
							)}
						</Card>
						<Card title="Recent activity" icon={MessageSquareQuote}>
							{recentActivities.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									Nothing logged yet.
								</p>
							) : (
								<ul className="divide-y divide-border/70">
									{recentActivities.map((a) => (
										<li key={a.id} className="py-2">
											<p className="flex items-baseline justify-between gap-2 text-sm">
												<span className="truncate">
													<span className="mr-1.5 rounded bg-muted px-1 text-[10px] font-semibold uppercase">
														{a.kind}
													</span>
													{a.subject}
												</span>
												<span className="shrink-0 text-[11px] text-muted-foreground">
													{shortDate(a.completedAt ?? a.createdAt)}
												</span>
											</p>
											{a.body ? (
												<p className="line-clamp-2 text-xs text-muted-foreground">
													{a.body}
												</p>
											) : null}
										</li>
									))}
								</ul>
							)}
						</Card>
					</div>

					<aside className="flex flex-col gap-4">
						<Card
							title="AI research"
							icon={Sparkles}
							action={
								statusQuery.data ? (
									<span className="font-mono text-[10px] text-muted-foreground">
										{statusQuery.data.model}
									</span>
								) : null
							}
						>
							{!aiAvailable ? (
								<p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
									Set <code>CRM_RESEARCH_GATEWAY_API_KEY</code> on the API to
									enable web research.
								</p>
							) : null}
							<Input
								placeholder="Optional: a specific question to answer"
								className="h-8 text-xs"
								value={question}
								onChange={(e) => setQuestion(e.target.value)}
							/>
							<div className="mt-2 flex flex-wrap gap-2">
								<Button
									size="sm"
									disabled={!aiAvailable || running !== null}
									onClick={() => runResearch("company")}
								>
									<Building2 className="h-4 w-4" />
									{running === "company"
										? "Researching…"
										: `Research ${call.account.name}`}
								</Button>
								{outside.slice(0, 3).map((a) => (
									<Button
										key={a.email}
										size="sm"
										variant="outline"
										disabled={!aiAvailable || running !== null}
										onClick={() => runResearch("person", a.email)}
									>
										<User className="h-4 w-4" />
										{running === a.email
											? "Researching…"
											: `Research ${a.name?.split(" ")[0] ?? a.email}`}
									</Button>
								))}
							</div>
							<p className="mt-2 text-[11px] text-muted-foreground">
								Searches the web through the gateway and saves the brief as a
								note on the account.
							</p>
							<div className="mt-3 flex flex-col gap-2">
								{running ? (
									<div className="rounded-lg border border-border/70 p-3">
										<Skeleton className="h-3 w-2/3" />
										<Skeleton className="mt-2 h-3 w-full" />
										<Skeleton className="mt-2 h-3 w-5/6" />
									</div>
								) : null}
								{(researchQuery.data?.notes ?? []).map((n) => (
									<ResearchNoteView key={n.id} note={n} />
								))}
								{researchQuery.data &&
								!researchQuery.data.notes.length &&
								!running ? (
									<p className="text-xs text-muted-foreground">
										No research yet for this account.
									</p>
								) : null}
							</div>
						</Card>
					</aside>
				</div>
			) : null}
		</div>
	);
}
