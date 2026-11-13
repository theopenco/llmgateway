"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	CalendarDays,
	Mail,
	Plus,
	Trash2,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

import { shortDate } from "./crm-meta";

import type { paths } from "@/lib/api/v1";

type IntegrationList =
	paths["/admin/crm/integrations"]["get"]["responses"]["200"]["content"]["application/json"];
type Integration = IntegrationList["integrations"][number];

function useIntegrations() {
	const $api = useApi();
	const queryClient = useQueryClient();
	const query = $api.useQuery("get", "/admin/crm/integrations");
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: $api.queryOptions("get", "/admin/crm/integrations").queryKey,
		});
	return { $api, query, refresh };
}

function MailIcon() {
	return (
		<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500 text-white">
			<Mail className="h-5 w-5" />
		</span>
	);
}

function ConnectionRow({
	row,
	onChanged,
}: {
	row: Integration;
	onChanged: () => void;
}) {
	const { $api } = useIntegrations();
	const update = $api.useMutation(
		"patch",
		"/admin/crm/integrations/{integrationId}",
		{
			onSuccess: onChanged,
			meta: { errorMessage: "Could not update the connection" },
		},
	);
	const remove = $api.useMutation(
		"delete",
		"/admin/crm/integrations/{integrationId}",
		{
			onSuccess: () => {
				toast.success(`${row.accountEmail} disconnected`);
				onChanged();
			},
			meta: { errorMessage: "Could not disconnect" },
		},
	);
	return (
		<li className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card p-4 md:flex-row md:items-center">
			<MailIcon />
			<div className="min-w-0 flex-1">
				<p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
					{row.displayName ? `${row.displayName} · ` : ""}
					<span className="font-mono font-medium">{row.accountEmail}</span>
					<span
						className={cn(
							"inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-semibold uppercase",
							row.calendar
								? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
								: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
						)}
					>
						<CalendarDays className="h-3 w-3" />
						{row.calendar
							? "mail + calendar"
							: "mail only · reconnect for calendar"}
					</span>
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					Connected by {row.mine ? "you" : (row.ownerEmail ?? "a teammate")} on{" "}
					{shortDate(row.createdAt)}
				</p>
			</div>
			<div className="flex items-center gap-4">
				<label className="flex items-center gap-2 text-xs">
					<Users className="h-3.5 w-3.5 text-muted-foreground" />
					<span className="text-muted-foreground">Team can use</span>
					<Switch
						checked={row.shared}
						disabled={!row.mine || update.isPending}
						onCheckedChange={(shared) =>
							update.mutate({
								params: { path: { integrationId: row.id } },
								body: { shared },
							})
						}
					/>
				</label>
				<Button
					size="icon"
					variant="ghost"
					aria-label="Disconnect"
					disabled={!row.mine || remove.isPending}
					onClick={() => {
						if (confirm(`Disconnect ${row.accountEmail}?`)) {
							remove.mutate({ params: { path: { integrationId: row.id } } });
						}
					}}
				>
					<Trash2 className="h-4 w-4" />
				</Button>
			</div>
		</li>
	);
}

function GmailConnect({ available }: { available: boolean }) {
	const { $api } = useIntegrations();
	const [shared, setShared] = useState(true);
	const connect = $api.useMutation(
		"post",
		"/admin/crm/integrations/gmail/connect",
		{
			onSuccess: ({ url }) => {
				window.location.assign(url);
			},
			meta: { errorMessage: "Could not start the Google sign-in" },
		},
	);
	return (
		<section className="rounded-xl border border-border/70 bg-card p-4">
			<div className="flex items-start gap-3">
				<MailIcon />
				<div className="flex-1">
					<h3 className="text-sm font-semibold">Connect a Gmail mailbox</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						Sign in with the Google account whose mail and calendar you want in
						the CRM. For a delegated inbox such as contact@, sign in as that
						account itself; Google does not expose delegated mail to the API.
						Reconnecting an existing mailbox adds calendar access. Connect the
						mailbox of whoever hosts Calendly calls: Calendly writes bookings
						into that calendar.
					</p>
					{!available ? (
						<p className="mt-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
							Set <code>CRM_GOOGLE_CLIENT_ID</code> /{" "}
							<code>CRM_GOOGLE_CLIENT_SECRET</code> on the API and add the
							callback URL to the OAuth client.
						</p>
					) : null}
					<div className="mt-3 flex flex-wrap items-center gap-4">
						<label className="flex items-center gap-2 text-xs">
							<Switch checked={shared} onCheckedChange={setShared} />
							<span>Let teammates send from it</span>
						</label>
						<Button
							size="sm"
							disabled={!available || connect.isPending}
							onClick={() => connect.mutate({ body: { shared } })}
						>
							<Plus className="h-4 w-4" />
							Connect Gmail
						</Button>
					</div>
				</div>
			</div>
		</section>
	);
}

export function CrmSettings() {
	const { query, refresh } = useIntegrations();
	const params = useSearchParams();
	const router = useRouter();

	useEffect(() => {
		const status = params.get("status");
		if (!status) {
			return;
		}
		if (status === "connected") {
			toast.success(
				`Gmail connected for ${params.get("account") ?? "mailbox"}`,
			);
		} else {
			toast.error(params.get("message") ?? "Connecting Gmail failed");
		}
		router.replace("/crm/settings");
	}, [params, router]);

	const rows = query.data?.integrations ?? [];
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
					Integrations
				</h1>
				<p className="mt-1 max-w-xl text-sm text-muted-foreground">
					Mailboxes and calendars the CRM reads and writes. Every connected
					mailbox shows threads and meetings with account contacts to the whole
					team; sending follows the sharing switch.
				</p>
			</header>

			<section>
				<h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Connected
				</h2>
				{query.isLoading ? (
					<Skeleton className="h-24 w-full rounded-xl" />
				) : rows.length === 0 ? (
					<div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
						Nothing connected yet.
					</div>
				) : (
					<ul className="flex flex-col gap-2">
						{rows.map((row) => (
							<ConnectionRow key={row.id} row={row} onChanged={refresh} />
						))}
					</ul>
				)}
			</section>

			<section className="flex flex-col gap-3">
				<h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
					Add
				</h2>
				<GmailConnect available={query.data?.gmailAvailable ?? false} />
			</section>
		</div>
	);
}
