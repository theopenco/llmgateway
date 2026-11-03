"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ChevronLeft,
	ExternalLink,
	Inbox,
	Mail,
	Paperclip,
	Reply,
	Send,
	Settings2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { type CrmAccountDetail, initials, shortDate } from "./crm-meta";

import type { paths } from "@/lib/api/v1";

type MailResponse =
	paths["/admin/crm/accounts/{id}/mail"]["get"]["responses"]["200"]["content"]["application/json"];
type Thread = MailResponse["threads"][number];
type Mailbox = MailResponse["mailboxes"][number];
type Message =
	paths["/admin/crm/integrations/{integrationId}/threads/{threadId}"]["get"]["responses"]["200"]["content"]["application/json"]["messages"][number];
type Person = CrmAccountDetail["people"][number];

function who(a: { name: string | null; email: string } | null) {
	return a ? (a.name ?? a.email) : "Unknown";
}

function timeOf(iso: string) {
	const d = new Date(iso);
	const sameDay = d.toDateString() === new Date().toDateString();
	return sameDay
		? d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })
		: shortDate(iso);
}

function gmailUrl(mailbox: string, threadId: string) {
	return `https://mail.google.com/mail/?authuser=${encodeURIComponent(mailbox)}#all/${threadId}`;
}

function useMailMutations(accountId: string) {
	const $api = useApi();
	const queryClient = useQueryClient();
	const refresh = () => {
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", "/admin/crm/accounts/{id}/mail", {
				params: { path: { id: accountId } },
			}).queryKey,
		});
		void queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", "/admin/crm/accounts/{id}", {
				params: { path: { id: accountId } },
			}).queryKey,
		});
		void queryClient.invalidateQueries({
			queryKey: [
				"get",
				"/admin/crm/integrations/{integrationId}/threads/{threadId}",
			],
		});
	};
	return {
		$api,
		refresh,
		send: $api.useMutation("post", "/admin/crm/accounts/{id}/mail", {
			meta: { inlineError: true },
		}),
	};
}

function MailboxPicker({
	mailboxes,
	value,
	onChange,
}: {
	mailboxes: Mailbox[];
	value: string;
	onChange: (id: string) => void;
}) {
	const usable = mailboxes.filter((m) => m.canSend);
	return (
		<select
			className="h-8 max-w-[260px] rounded-md border border-border bg-background px-2 text-xs"
			value={value}
			onChange={(e) => onChange(e.target.value)}
		>
			{usable.map((m) => (
				<option key={m.id} value={m.id}>
					From {m.email}
				</option>
			))}
		</select>
	);
}

function ComposeForm({
	accountId,
	people,
	mailboxes,
	reply,
	onDone,
	onCancel,
}: {
	accountId: string;
	people: Person[];
	mailboxes: Mailbox[];
	reply?: {
		integrationId: string;
		threadId: string;
		subject: string;
		to: string[];
		cc: string[];
		inReplyTo: string;
		references: string;
	};
	onDone: (threadId: string) => void;
	onCancel?: () => void;
}) {
	const m = useMailMutations(accountId);
	const usable = mailboxes.filter((mb) => mb.canSend);
	const [mailbox, setMailbox] = useState(
		reply?.integrationId && usable.some((mb) => mb.id === reply.integrationId)
			? reply.integrationId
			: (usable[0]?.id ?? ""),
	);
	const [to, setTo] = useState<string[]>(
		reply?.to ?? (people[0] ? [people[0].email] : []),
	);
	const [cc, setCc] = useState(reply?.cc.join(", ") ?? "");
	const [subject, setSubject] = useState(
		reply ? `Re: ${reply.subject.replace(/^(re|fwd?):\s*/i, "")}` : "",
	);
	const [text, setText] = useState("");
	const [error, setError] = useState<string | null>(null);

	if (!usable.length) {
		return (
			<p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
				No mailbox you can send from.{" "}
				<Link href="/crm/settings" className="underline">
					Connect one
				</Link>{" "}
				or ask a teammate to share theirs.
			</p>
		);
	}

	// Thread participants outside the CRM stay visible (and removable) too.
	const recipients = [
		...people.map((p) => ({ email: p.email, label: p.name ?? p.email })),
		...to
			.filter((e) => !people.some((p) => p.email === e))
			.map((e) => ({ email: e, label: e })),
	];
	const toggle = (email: string) =>
		setTo((prev) =>
			prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
		);
	const ccList = cc
		.split(/[,\s]+/)
		.map((e) => e.trim().toLowerCase())
		.filter((e) => e.includes("@"));

	return (
		<form
			className="flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-3"
			onSubmit={(e) => {
				e.preventDefault();
				setError(null);
				if (!to.length || !subject.trim() || !text.trim()) {
					return;
				}
				m.send.mutate(
					{
						params: { path: { id: accountId } },
						body: {
							integrationId: mailbox,
							to,
							cc: ccList.length ? ccList : undefined,
							subject: subject.trim(),
							text,
							threadId: reply?.threadId,
							inReplyTo: reply?.inReplyTo || undefined,
							references: reply?.references || undefined,
						},
					},
					{
						onSuccess: (res) => {
							toast.success(reply ? "Reply sent" : "Email sent");
							m.refresh();
							onDone(res.threadId);
						},
						onError: (err) =>
							setError(
								(err as { message?: string })?.message ?? "Sending failed",
							),
					},
				);
			}}
		>
			<div className="flex flex-wrap items-center gap-2">
				<MailboxPicker
					mailboxes={mailboxes}
					value={mailbox}
					onChange={setMailbox}
				/>
				<span className="text-xs text-muted-foreground">to</span>
				<div className="flex flex-wrap gap-1">
					{recipients.map((p) => (
						<button
							key={p.email}
							type="button"
							onClick={() => toggle(p.email)}
							className={cn(
								"rounded-md px-2 py-1 text-xs transition",
								to.includes(p.email)
									? "bg-foreground text-background"
									: "bg-muted text-muted-foreground hover:text-foreground",
							)}
							title={p.email}
						>
							{p.label}
						</button>
					))}
				</div>
			</div>
			<Input
				placeholder="Cc (comma separated)"
				className="h-8 text-xs"
				value={cc}
				onChange={(e) => setCc(e.target.value)}
			/>
			<Input
				placeholder="Subject"
				value={subject}
				onChange={(e) => setSubject(e.target.value)}
				required
			/>
			<Textarea
				className="min-h-[140px]"
				placeholder="Write your message…"
				value={text}
				onChange={(e) => setText(e.target.value)}
				required
			/>
			{error ? <p className="text-xs text-rose-600">{error}</p> : null}
			<div className="flex items-center justify-between gap-2">
				<p className="text-[11px] text-muted-foreground">
					Plain text, sent through Gmail and logged on this account.
				</p>
				<div className="flex gap-2">
					{onCancel ? (
						<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
							Cancel
						</Button>
					) : null}
					<Button
						type="submit"
						size="sm"
						disabled={m.send.isPending || !to.length}
					>
						<Send className="h-4 w-4" />
						{reply ? "Send reply" : "Send"}
					</Button>
				</div>
			</div>
		</form>
	);
}

function MessageCard({
	message,
	mailbox,
}: {
	message: Message;
	mailbox: string;
}) {
	const outbound = message.from?.email === mailbox;
	const [expanded, setExpanded] = useState(true);
	return (
		<article
			className={cn(
				"rounded-xl border p-3",
				outbound
					? "border-sky-500/30 bg-sky-500/5"
					: "border-border/70 bg-card",
			)}
		>
			<button
				type="button"
				className="flex w-full items-start gap-3 text-left"
				onClick={() => setExpanded((v) => !v)}
			>
				<span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold">
					{initials(who(message.from))}
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-2">
						<p className="truncate text-sm font-semibold">
							{who(message.from)}
							{outbound ? (
								<span className="ml-1.5 text-[10px] font-medium uppercase text-sky-600">
									you
								</span>
							) : null}
						</p>
						<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
							{timeOf(message.date)}
						</span>
					</div>
					<p className="truncate text-[11px] text-muted-foreground">
						to {message.to.map(who).join(", ")}
						{message.cc.length ? ` · cc ${message.cc.map(who).join(", ")}` : ""}
					</p>
				</div>
			</button>
			{expanded ? (
				<div className="mt-3 pl-11">
					<pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
						{message.text || message.snippet}
					</pre>
					{message.attachments.length ? (
						<p className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
							<Paperclip className="h-3 w-3" />
							{message.attachments.join(", ")}
						</p>
					) : null}
				</div>
			) : null}
		</article>
	);
}

function ThreadView({
	accountId,
	thread,
	people,
	mailboxes,
	onBack,
}: {
	accountId: string;
	thread: Thread;
	people: Person[];
	mailboxes: Mailbox[];
	onBack: () => void;
}) {
	const $api = useApi();
	const [replying, setReplying] = useState(false);
	const { data, isLoading, error } = $api.useQuery(
		"get",
		"/admin/crm/integrations/{integrationId}/threads/{threadId}",
		{
			params: {
				path: {
					integrationId: thread.integrationId,
					threadId: thread.threadId,
				},
			},
		},
	);
	const last = data?.messages.at(-1);
	const external = (a: { email: string }) => a.email !== thread.mailbox;
	const replyTo = last
		? [
				...(last.from && external(last.from) ? [last.from.email] : []),
				...last.to.filter(external).map((a) => a.email),
			]
		: [];
	const references = data?.messages
		.map((m) => m.messageId)
		.filter(Boolean)
		.join(" ");

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<button
					type="button"
					onClick={onBack}
					className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
				>
					<ChevronLeft className="h-3.5 w-3.5" />
					All threads
				</button>
				<div className="flex items-center gap-2">
					<a
						href={gmailUrl(thread.mailbox, thread.threadId)}
						target="_blank"
						rel="noreferrer"
						className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
					>
						Open in Gmail
						<ExternalLink className="h-3 w-3" />
					</a>
					<Button
						size="sm"
						variant="outline"
						onClick={() => setReplying(true)}
						disabled={!last}
					>
						<Reply className="h-4 w-4" />
						Reply
					</Button>
				</div>
			</div>
			<div>
				<h3 className="font-display text-lg font-semibold">{thread.subject}</h3>
				<p className="text-xs text-muted-foreground">
					{thread.mailbox} · {thread.messageCount} message
					{thread.messageCount === 1 ? "" : "s"}
				</p>
			</div>
			{isLoading ? <Skeleton className="h-40 w-full rounded-xl" /> : null}
			{error ? (
				<p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-700">
					Could not load this thread from Gmail.
				</p>
			) : null}
			{data?.messages.map((msg) => (
				<MessageCard key={msg.id} message={msg} mailbox={data.mailbox} />
			))}
			{replying && last ? (
				<ComposeForm
					accountId={accountId}
					people={people}
					mailboxes={mailboxes}
					reply={{
						integrationId: thread.integrationId,
						threadId: thread.threadId,
						subject: last.subject || thread.subject,
						to: replyTo.length
							? replyTo
							: thread.participants.map((p) => p.email),
						cc: last.cc.filter(external).map((a) => a.email),
						inReplyTo: last.messageId,
						references: references ?? "",
					}}
					onDone={() => setReplying(false)}
					onCancel={() => setReplying(false)}
				/>
			) : null}
		</div>
	);
}

export function MailPanel({
	accountId,
	people,
}: {
	accountId: string;
	people: Person[];
}) {
	const $api = useApi();
	const [open, setOpen] = useState<Thread | null>(null);
	const [composing, setComposing] = useState(false);
	const { data, isLoading, error, refetch, isFetching } = $api.useQuery(
		"get",
		"/admin/crm/accounts/{id}/mail",
		{ params: { path: { id: accountId } } },
		{ staleTime: 60_000 },
	);

	if (isLoading) {
		return (
			<div className="flex flex-col gap-2">
				<Skeleton className="h-10 w-full rounded-xl" />
				<Skeleton className="h-64 w-full rounded-xl" />
			</div>
		);
	}
	if (error || !data) {
		return (
			<p className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-700">
				Could not reach the mail integration.
			</p>
		);
	}
	if (!data.mailboxes.length) {
		return (
			<div className="rounded-xl border border-dashed border-border p-10 text-center">
				<Mail className="mx-auto h-8 w-8 text-muted-foreground" />
				<p className="mt-3 text-sm font-medium">No mailbox connected</p>
				<p className="mt-1 text-sm text-muted-foreground">
					Connect contact@ or your own Gmail to read and answer this account's
					threads here.
				</p>
				<Button asChild size="sm" className="mt-4">
					<Link href="/crm/settings">
						<Settings2 className="h-4 w-4" />
						Integrations
					</Link>
				</Button>
			</div>
		);
	}
	if (open) {
		return (
			<ThreadView
				accountId={accountId}
				thread={open}
				people={people}
				mailboxes={data.mailboxes}
				onBack={() => setOpen(null)}
			/>
		);
	}
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">
					Threads with {people.length} contact{people.length === 1 ? "" : "s"}{" "}
					across {data.mailboxes.map((m) => m.email).join(", ")}
				</p>
				<div className="flex items-center gap-2">
					<Button
						size="sm"
						variant="ghost"
						onClick={() => void refetch()}
						disabled={isFetching}
					>
						Refresh
					</Button>
					<Button size="sm" onClick={() => setComposing((v) => !v)}>
						<Mail className="h-4 w-4" />
						New email
					</Button>
				</div>
			</div>
			{composing ? (
				<ComposeForm
					accountId={accountId}
					people={people}
					mailboxes={data.mailboxes}
					onDone={() => setComposing(false)}
					onCancel={() => setComposing(false)}
				/>
			) : null}
			{data.errors.map((e) => (
				<p
					key={e.mailbox}
					className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300"
				>
					{e.mailbox}: {e.message}
				</p>
			))}
			{data.threads.length === 0 ? (
				<div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
					<Inbox className="mx-auto mb-2 h-6 w-6" />
					No email with this account yet.
				</div>
			) : (
				<ul className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border/70 bg-card">
					{data.threads.map((t) => (
						<li key={`${t.integrationId}:${t.threadId}`}>
							<button
								type="button"
								onClick={() => setOpen(t)}
								className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/50"
							>
								<span
									className={cn(
										"mt-1.5 h-2 w-2 shrink-0 rounded-full",
										t.unread ? "bg-sky-500" : "bg-transparent",
									)}
								/>
								<div className="min-w-0 flex-1">
									<div className="flex items-baseline justify-between gap-3">
										<p
											className={cn(
												"truncate text-sm",
												t.unread ? "font-semibold" : "font-medium",
											)}
										>
											{t.subject}
										</p>
										<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
											{timeOf(t.lastAt)}
										</span>
									</div>
									<p className="truncate text-xs text-muted-foreground">
										<span className="text-foreground/80">
											{who(t.lastFrom)}
										</span>
										{" — "}
										{t.snippet}
									</p>
									<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
										{t.participants.map(who).join(", ")} · {t.mailbox}
										{t.messageCount > 1 ? ` · ${t.messageCount}` : ""}
									</p>
								</div>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
