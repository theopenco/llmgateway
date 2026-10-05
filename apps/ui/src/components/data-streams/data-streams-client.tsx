"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
	History,
	Pause,
	Play,
	Radio,
	Send,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import {
	ContactSalesButton,
	EnterpriseFeaturePage,
} from "@/components/contact-sales";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/lib/components/dialog";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { Time } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { paths } from "@/lib/api/v1";

type Source = "audit_logs" | "request_logs";
type Stream =
	paths["/data-streams"]["get"]["responses"][200]["content"]["application/json"]["streams"][number];

const ALL_PROJECTS = "__all__";

function errorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "Something went wrong";
}

function Field({
	id,
	label,
	value,
	onChange,
	placeholder,
	type = "text",
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	type?: string;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Input
				id={id}
				type={type}
				value={value}
				placeholder={placeholder}
				autoComplete="off"
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

function CreateStreamDialog({
	organizationId,
	source,
}: {
	organizationId: string;
	source: Source;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { projects } = useDashboardNavigation();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [projectId, setProjectId] = useState(ALL_PROJECTS);
	const [url, setUrl] = useState("");
	const [signingSecret, setSigningSecret] = useState("");
	const [token, setToken] = useState("");
	const create = api.useMutation("post", "/data-streams");

	const submit = async () => {
		try {
			await create.mutateAsync({
				body: {
					organizationId,
					name,
					source,
					destination: "webhook",
					projectId:
						source === "request_logs" && projectId !== ALL_PROJECTS
							? projectId
							: null,
					config: { url },
					secret: { signingSecret, token: token || undefined },
				},
			});
			await queryClient.invalidateQueries({
				queryKey: ["get", "/data-streams"],
			});
			setOpen(false);
			setName("");
			setUrl("");
			setSigningSecret("");
			setToken("");
			toast({
				title: "Stream created",
				description: "New events are delivered within a few minutes.",
			});
		} catch (error) {
			toast({
				title: "Could not create stream",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button size="sm">
					<Radio className="mr-2 h-4 w-4" />
					New stream
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>
						{source === "audit_logs"
							? "Forward audit logs"
							: "Export request logs"}
					</DialogTitle>
					<DialogDescription>
						{source === "audit_logs"
							? "Every admin action in the organization is posted to your endpoint as it happens."
							: "One event per gateway request: model, provider, tokens, cost, latency, and finish reason. Never prompts or completions."}{" "}
						Secrets are encrypted at rest and never shown again.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<Field
						id="stream-name"
						label="Name"
						value={name}
						onChange={setName}
						placeholder={
							source === "audit_logs" ? "Security SIEM" : "Data warehouse"
						}
					/>
					{source === "request_logs" ? (
						<div className="space-y-2">
							<Label>Projects</Label>
							<Select value={projectId} onValueChange={setProjectId}>
								<SelectTrigger aria-label="Project">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={ALL_PROJECTS}>All projects</SelectItem>
									{projects.map((project) => (
										<SelectItem key={project.id} value={project.id}>
											{project.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}
					<Field
						id="hook-url"
						label="HTTPS endpoint"
						value={url}
						onChange={setUrl}
						placeholder="https://logs.example.com/llmgateway"
					/>
					<Field
						id="hook-secret"
						label="Signing secret (16+ characters)"
						type="password"
						value={signingSecret}
						onChange={setSigningSecret}
					/>
					<Field
						id="hook-token"
						label="Bearer token (optional)"
						type="password"
						value={token}
						onChange={setToken}
					/>
				</div>
				<DialogFooter>
					<Button
						onClick={submit}
						disabled={!name || !url || !signingSecret || create.isPending}
					>
						{create.isPending ? "Creating..." : "Create stream"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function toLocalInput(date: Date): string {
	const offset = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function ReplayDialog({ streamId }: { streamId: string }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const now = new Date();
	const [from, setFrom] = useState(
		toLocalInput(new Date(now.getTime() - 86_400_000)),
	);
	const [to, setTo] = useState(toLocalInput(now));
	const replay = api.useMutation("post", "/data-streams/{id}/replay");
	const submit = async () => {
		try {
			await replay.mutateAsync({
				params: { path: { id: streamId } },
				body: {
					from: new Date(from).toISOString(),
					to: new Date(to).toISOString(),
				},
			});
			await queryClient.invalidateQueries({
				queryKey: ["get", "/data-streams"],
			});
			setOpen(false);
			toast({
				title: "Replay scheduled",
				description: "Events are re-sent on the next run.",
			});
		} catch (error) {
			toast({
				title: "Could not replay",
				description: errorMessage(error),
				variant: "destructive",
			});
		}
	};
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button variant="outline" size="sm">
					<History className="mr-1 h-4 w-4" />
					Replay
				</Button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Replay a window</DialogTitle>
					<DialogDescription>
						Re-send every event in the window, up to 30 days. Live delivery
						continues alongside it.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field
						id="replay-from"
						label="From"
						type="datetime-local"
						value={from}
						onChange={setFrom}
					/>
					<Field
						id="replay-to"
						label="To"
						type="datetime-local"
						value={to}
						onChange={setTo}
					/>
				</div>
				<DialogFooter>
					<Button onClick={submit} disabled={replay.isPending}>
						{replay.isPending ? "Scheduling..." : "Replay"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function StatusBadge({ stream }: { stream: Stream }) {
	if (!stream.enabled) {
		return (
			<Badge variant={stream.pausedReason ? "destructive" : "secondary"}>
				Paused
			</Badge>
		);
	}
	if (stream.lastError) {
		return <Badge variant="destructive">Retrying</Badge>;
	}
	return <Badge>Active</Badge>;
}

function StreamCard({
	stream,
	canResume,
}: {
	stream: Stream;
	canResume: boolean;
}) {
	const api = useApi();
	const queryClient = useQueryClient();
	const update = api.useMutation("patch", "/data-streams/{id}");
	const remove = api.useMutation("delete", "/data-streams/{id}");
	const test = api.useMutation("post", "/data-streams/{id}/test");
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/data-streams"] });

	return (
		<Card>
			<CardHeader className="space-y-1">
				<div className="flex items-start justify-between gap-2">
					<CardTitle className="text-lg">{stream.name}</CardTitle>
					<StatusBadge stream={stream} />
				</div>
				<CardDescription className="break-all">
					{stream.config.url}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<dl className="grid grid-cols-2 gap-2 text-sm">
					<dt className="text-muted-foreground">Delivered</dt>
					<dd className="text-right font-medium">
						{formatNumber(stream.deliveredCount)} events
					</dd>
					<dt className="text-muted-foreground">Last delivery</dt>
					<dd className="text-right">
						{stream.lastDeliveredAt ? (
							<Time date={stream.lastDeliveredAt} />
						) : (
							"Not yet"
						)}
					</dd>
					{stream.replayFrom ? (
						<>
							<dt className="text-muted-foreground">Replay</dt>
							<dd className="text-right">In progress</dd>
						</>
					) : null}
				</dl>
				{stream.pausedReason ? (
					<div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
						<TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
						<span>
							{stream.pausedReason}. Fix the endpoint, then resume; delivery
							continues from where it stopped.
						</span>
					</div>
				) : null}
				{stream.lastError ? (
					<div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
						<TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
						<span className="break-all">
							{stream.lastError}
							{stream.enabled && stream.failureCount > 0
								? ` (${stream.failureCount} in a row, retrying with backoff)`
								: null}
						</span>
					</div>
				) : null}
				<div className="flex flex-wrap gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={test.isPending}
						onClick={async () => {
							try {
								const result = await test.mutateAsync({
									params: { path: { id: stream.id } },
								});
								toast(
									result.success
										? { title: "Test event delivered" }
										: {
												title: "Test event failed",
												description: result.error ?? undefined,
												variant: "destructive",
											},
								);
							} catch (error) {
								toast({
									title: "Could not send test event",
									description: errorMessage(error),
									variant: "destructive",
								});
							}
						}}
					>
						<Send className="mr-1 h-4 w-4" />
						Send test event
					</Button>
					<ReplayDialog streamId={stream.id} />
					<Button
						variant="outline"
						size="sm"
						disabled={!stream.enabled && !canResume}
						onClick={async () => {
							try {
								await update.mutateAsync({
									params: { path: { id: stream.id } },
									body: { enabled: !stream.enabled },
								});
								await refresh();
							} catch (error) {
								toast({
									title: "Could not update stream",
									description: errorMessage(error),
									variant: "destructive",
								});
							}
						}}
					>
						{stream.enabled ? (
							<Pause className="mr-1 h-4 w-4" />
						) : (
							<Play className="mr-1 h-4 w-4" />
						)}
						{stream.enabled ? "Pause" : "Resume"}
					</Button>
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Delete ${stream.name}`}
						onClick={async () => {
							if (!window.confirm(`Delete "${stream.name}"?`)) {
								return;
							}
							try {
								await remove.mutateAsync({
									params: { path: { id: stream.id } },
								});
								await refresh();
							} catch (error) {
								toast({
									title: "Could not delete stream",
									description: errorMessage(error),
									variant: "destructive",
								});
							}
						}}
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function Section({
	title,
	description,
	action,
	streams,
	emptyText,
	canResume,
}: {
	title: string;
	description: string;
	action: ReactNode;
	streams: Stream[];
	emptyText: string;
	canResume: boolean;
}) {
	return (
		<section className="space-y-4">
			<div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
				<div>
					<h3 className="text-xl font-semibold tracking-tight">{title}</h3>
					<p className="text-sm text-muted-foreground">{description}</p>
				</div>
				{action}
			</div>
			{streams.length === 0 ? (
				<Card>
					<CardContent className="p-6 text-sm text-muted-foreground">
						{emptyText}
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 lg:grid-cols-2">
					{streams.map((stream) => (
						<StreamCard key={stream.id} stream={stream} canResume={canResume} />
					))}
				</div>
			)}
		</section>
	);
}

export function DataStreamsClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const api = useApi();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const isAdmin = role === "owner" || role === "admin";
	const enterprise = selectedOrganization?.enterpriseAccess === true;
	const opened = selectedOrganization?.dataStreamsEnabled === true;

	const list = api.useQuery(
		"get",
		"/data-streams",
		{ params: { query: { organizationId } } },
		{ enabled: enterprise && opened && isAdmin },
	);

	if (selectedOrganization && !enterprise) {
		return (
			<EnterpriseFeaturePage
				title="Data Streams"
				description="Data streams are available on the Enterprise plan"
				features={[
					"Forward audit logs to your SIEM over HTTPS",
					"Export request log metadata to your data stack",
					"Signed, retried delivery with an at-least-once cursor",
					"Replay any window of the last 30 days on demand",
				]}
			>
				Stream your organization&apos;s audit and request logs to the tools your
				security and data teams already use. Only metadata is ever sent, never
				prompts or completions.
			</EnterpriseFeaturePage>
		);
	}

	const streams = list.data?.streams ?? [];
	const requestLogExportEnabled = list.data?.requestLogExportEnabled === true;

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-8 p-4 pt-6 md:p-8">
				<div>
					<h2 className="text-3xl font-bold tracking-tight">Data Streams</h2>
					<p className="text-muted-foreground">
						Forward audit logs to your SIEM and export request log metadata to
						your own HTTPS endpoint
					</p>
				</div>

				{selectedOrganization && !opened ? (
					<Card className="max-w-2xl">
						<CardHeader>
							<CardTitle>Not enabled yet</CardTitle>
							<CardDescription>
								Data streams are switched on per organization so we can size the
								export together with you first.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<p className="text-sm text-muted-foreground">
								Contact us and we will enable SIEM forwarding, and request log
								export if you need it, for this organization.
							</p>
							<ContactSalesButton />
						</CardContent>
					</Card>
				) : !isAdmin && teamData ? (
					<Card>
						<CardContent className="p-6 text-sm text-muted-foreground">
							Only organization owners and admins can manage data streams.
						</CardContent>
					</Card>
				) : list.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading streams...</p>
				) : list.isError ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-2 p-10 text-center">
							<TriangleAlert className="h-8 w-8 text-destructive" />
							<p className="font-medium">Could not load data streams</p>
							<p className="max-w-md text-sm text-muted-foreground">
								{errorMessage(list.error)}
							</p>
						</CardContent>
					</Card>
				) : (
					<>
						<Section
							title="SIEM forwarding"
							description="Audit logs: every admin action in the organization, as it happens."
							action={
								<CreateStreamDialog
									organizationId={organizationId}
									source="audit_logs"
								/>
							}
							streams={streams.filter((s) => s.source === "audit_logs")}
							emptyText="No audit log streams yet. Add your SIEM's HTTPS endpoint to start forwarding."
							canResume
						/>
						<Section
							title="Log export"
							description="Request logs: one event per gateway request with model, tokens, cost, and latency. Metadata only, never prompts or completions."
							action={
								requestLogExportEnabled ? (
									<CreateStreamDialog
										organizationId={organizationId}
										source="request_logs"
									/>
								) : null
							}
							streams={streams.filter((s) => s.source === "request_logs")}
							emptyText={
								requestLogExportEnabled
									? "No request log streams yet."
									: "Request log export is off for this organization. It is enabled per organization because each pass reads your request logs; contact us to turn it on."
							}
							canResume={requestLogExportEnabled}
						/>
					</>
				)}
			</div>
		</div>
	);
}
