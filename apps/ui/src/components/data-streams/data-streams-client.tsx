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
import { useState } from "react";

import { EnterpriseFeaturePage } from "@/components/contact-sales";
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
import { Switch } from "@/lib/components/switch";
import { toast } from "@/lib/components/use-toast";
import { useApi } from "@/lib/fetch-client";

import { Time } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

type Source = "audit_logs" | "request_logs";
type Destination = "webhook" | "datadog" | "splunk" | "s3";

const SOURCES: { value: Source; label: string; description: string }[] = [
	{
		value: "audit_logs",
		label: "Audit logs (SIEM forwarding)",
		description: "Every admin action in the organization.",
	},
	{
		value: "request_logs",
		label: "Request logs (log export)",
		description: "One event per gateway request: model, tokens, cost, latency.",
	},
];

const DESTINATIONS: { value: Destination; label: string }[] = [
	{ value: "splunk", label: "Splunk HEC" },
	{ value: "datadog", label: "Datadog Logs" },
	{ value: "s3", label: "Amazon S3 (or S3-compatible)" },
	{ value: "webhook", label: "HTTPS webhook" },
];

const DATADOG_SITES = [
	"datadoghq.com",
	"us3.datadoghq.com",
	"us5.datadoghq.com",
	"datadoghq.eu",
	"ap1.datadoghq.com",
	"ddog-gov.com",
];

const ALL_PROJECTS = "__all__";

function errorMessage(error: unknown): string {
	if (error && typeof error === "object" && "message" in error) {
		return String((error as { message: unknown }).message);
	}
	return "Something went wrong";
}

function destinationLabel(destination: string): string {
	return (
		DESTINATIONS.find((d) => d.value === destination)?.label ?? destination
	);
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

function CreateStreamDialog({ organizationId }: { organizationId: string }) {
	const api = useApi();
	const queryClient = useQueryClient();
	const { projects } = useDashboardNavigation();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [source, setSource] = useState<Source>("audit_logs");
	const [destination, setDestination] = useState<Destination>("splunk");
	const [projectId, setProjectId] = useState(ALL_PROJECTS);
	const [includePayloads, setIncludePayloads] = useState(false);
	const [values, setValues] = useState<Record<string, string>>({
		site: "datadoghq.com",
	});
	const create = api.useMutation("post", "/data-streams");
	const set = (key: string) => (value: string) =>
		setValues((current) => ({ ...current, [key]: value }));
	const v = (key: string) => values[key] ?? "";

	const submit = async () => {
		const config = {
			...(destination === "webhook" || destination === "splunk"
				? { url: v("url") }
				: {}),
			...(destination === "splunk" && v("index") ? { index: v("index") } : {}),
			...(destination === "datadog"
				? {
						site: v("site") as (typeof DATADOG_SITES)[number],
						service: v("service") || undefined,
					}
				: {}),
			...(destination === "s3"
				? {
						bucket: v("bucket"),
						region: v("region"),
						accessKeyId: v("accessKeyId"),
						prefix: v("prefix") || undefined,
						endpoint: v("endpoint") || undefined,
					}
				: {}),
			...(source === "request_logs" ? { includePayloads } : {}),
		};
		const secret = {
			...(destination === "splunk" ? { token: v("token") } : {}),
			...(destination === "webhook"
				? {
						signingSecret: v("signingSecret"),
						token: v("token") || undefined,
					}
				: {}),
			...(destination === "datadog" ? { apiKey: v("apiKey") } : {}),
			...(destination === "s3"
				? { secretAccessKey: v("secretAccessKey") }
				: {}),
		};
		try {
			await create.mutateAsync({
				body: {
					organizationId,
					name,
					source,
					destination,
					projectId:
						source === "request_logs" && projectId !== ALL_PROJECTS
							? projectId
							: null,
					config: config as never,
					secret,
				},
			});
			await queryClient.invalidateQueries({
				queryKey: ["get", "/data-streams"],
			});
			setOpen(false);
			setName("");
			setValues({ site: "datadoghq.com" });
			toast({
				title: "Data stream created",
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
				<Button>
					<Radio className="mr-2 h-4 w-4" />
					New stream
				</Button>
			</DialogTrigger>
			<DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>New data stream</DialogTitle>
					<DialogDescription>
						Credentials are encrypted at rest and never shown again.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-4">
					<Field
						id="stream-name"
						label="Name"
						value={name}
						onChange={setName}
						placeholder="Security SIEM"
					/>
					<div className="space-y-2">
						<Label>What to send</Label>
						<Select
							value={source}
							onValueChange={(value) => setSource(value as Source)}
						>
							<SelectTrigger aria-label="Source">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{SOURCES.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							{SOURCES.find((option) => option.value === source)?.description}
						</p>
					</div>
					{source === "request_logs" ? (
						<>
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
							<label className="flex items-center justify-between gap-4 rounded-lg border p-3 text-sm">
								<span>
									<span className="font-medium">
										Include prompts and completions
									</span>
									<span className="block text-muted-foreground">
										Off by default. Payloads already removed by retention stay
										empty.
									</span>
								</span>
								<Switch
									checked={includePayloads}
									onCheckedChange={setIncludePayloads}
								/>
							</label>
						</>
					) : null}
					<div className="space-y-2">
						<Label>Destination</Label>
						<Select
							value={destination}
							onValueChange={(value) => setDestination(value as Destination)}
						>
							<SelectTrigger aria-label="Destination">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DESTINATIONS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					{destination === "splunk" ? (
						<>
							<Field
								id="splunk-url"
								label="HEC URL"
								value={v("url")}
								onChange={set("url")}
								placeholder="https://splunk.example.com:8088"
							/>
							<Field
								id="splunk-token"
								label="HEC token"
								type="password"
								value={v("token")}
								onChange={set("token")}
							/>
							<Field
								id="splunk-index"
								label="Index (optional)"
								value={v("index")}
								onChange={set("index")}
							/>
						</>
					) : null}
					{destination === "datadog" ? (
						<>
							<div className="space-y-2">
								<Label>Site</Label>
								<Select value={v("site")} onValueChange={set("site")}>
									<SelectTrigger aria-label="Datadog site">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{DATADOG_SITES.map((site) => (
											<SelectItem key={site} value={site}>
												{site}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<Field
								id="dd-key"
								label="API key"
								type="password"
								value={v("apiKey")}
								onChange={set("apiKey")}
							/>
							<Field
								id="dd-service"
								label="Service (optional)"
								value={v("service")}
								onChange={set("service")}
								placeholder="llmgateway"
							/>
						</>
					) : null}
					{destination === "s3" ? (
						<>
							<div className="grid gap-4 sm:grid-cols-2">
								<Field
									id="s3-bucket"
									label="Bucket"
									value={v("bucket")}
									onChange={set("bucket")}
								/>
								<Field
									id="s3-region"
									label="Region"
									value={v("region")}
									onChange={set("region")}
									placeholder="eu-central-1"
								/>
							</div>
							<Field
								id="s3-key-id"
								label="Access key ID"
								value={v("accessKeyId")}
								onChange={set("accessKeyId")}
							/>
							<Field
								id="s3-secret"
								label="Secret access key"
								type="password"
								value={v("secretAccessKey")}
								onChange={set("secretAccessKey")}
							/>
							<Field
								id="s3-prefix"
								label="Key prefix (optional)"
								value={v("prefix")}
								onChange={set("prefix")}
								placeholder="llmgateway"
							/>
							<Field
								id="s3-endpoint"
								label="Custom endpoint (optional)"
								value={v("endpoint")}
								onChange={set("endpoint")}
								placeholder="https://<account>.r2.cloudflarestorage.com"
							/>
						</>
					) : null}
					{destination === "webhook" ? (
						<>
							<Field
								id="hook-url"
								label="URL"
								value={v("url")}
								onChange={set("url")}
								placeholder="https://logs.example.com/llmgateway"
							/>
							<Field
								id="hook-secret"
								label="Signing secret (16+ characters)"
								type="password"
								value={v("signingSecret")}
								onChange={set("signingSecret")}
							/>
							<Field
								id="hook-token"
								label="Bearer token (optional)"
								type="password"
								value={v("token")}
								onChange={set("token")}
							/>
						</>
					) : null}
				</div>
				<DialogFooter>
					<Button onClick={submit} disabled={!name || create.isPending}>
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

export function DataStreamsClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const api = useApi();
	const queryClient = useQueryClient();
	const { selectedOrganization } = useDashboardNavigation();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);
	const role = teamData?.members.find((m) => m.userId === user?.id)?.role;
	const isAdmin = role === "owner" || role === "admin";
	const enterprise = selectedOrganization?.enterpriseAccess === true;

	const list = api.useQuery(
		"get",
		"/data-streams",
		{ params: { query: { organizationId } } },
		{ enabled: enterprise && isAdmin },
	);
	const update = api.useMutation("patch", "/data-streams/{id}");
	const remove = api.useMutation("delete", "/data-streams/{id}");
	const test = api.useMutation("post", "/data-streams/{id}/test");
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: ["get", "/data-streams"] });

	if (selectedOrganization && !enterprise) {
		return (
			<EnterpriseFeaturePage
				title="Data Streams"
				description="Data streams are available on the Enterprise plan"
				features={[
					"Forward audit logs to Splunk, Datadog, or any SIEM",
					"Export request logs to S3, Datadog, or a webhook",
					"Signed, retried delivery with an at-least-once cursor",
					"Replay any window of the last 30 days on demand",
				]}
			>
				Stream your organization's audit and request logs to the tools your
				security and data teams already use.
			</EnterpriseFeaturePage>
		);
	}

	const streams = list.data?.streams ?? [];

	return (
		<div className="flex flex-col">
			<div className="flex flex-col space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col space-y-4 md:flex-row md:items-center md:justify-between md:space-y-0">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Data Streams</h2>
						<p className="text-muted-foreground">
							Forward audit logs to your SIEM and export request logs to your
							data stack
						</p>
					</div>
					{isAdmin ? (
						<CreateStreamDialog organizationId={organizationId} />
					) : null}
				</div>

				{!isAdmin && teamData ? (
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
				) : streams.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-2 p-10 text-center">
							<Radio className="h-8 w-8 text-muted-foreground" />
							<p className="font-medium">No data streams yet</p>
							<p className="max-w-md text-sm text-muted-foreground">
								Send audit events to Splunk or Datadog, or land every request in
								an S3 bucket.
							</p>
						</CardContent>
					</Card>
				) : (
					<div className="grid gap-4 lg:grid-cols-2">
						{streams.map((stream) => (
							<Card key={stream.id}>
								<CardHeader className="space-y-1">
									<div className="flex items-start justify-between gap-2">
										<CardTitle className="text-lg">{stream.name}</CardTitle>
										{stream.enabled ? (
											stream.lastError ? (
												<Badge variant="destructive">Failing</Badge>
											) : (
												<Badge>Active</Badge>
											)
										) : (
											<Badge variant="secondary">Paused</Badge>
										)}
									</div>
									<CardDescription>
										{stream.source === "audit_logs"
											? "Audit logs"
											: "Request logs"}{" "}
										→ {destinationLabel(stream.destination)}
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
									{stream.lastError ? (
										<div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
											<TriangleAlert className="h-4 w-4 shrink-0 text-destructive" />
											<span className="break-all">{stream.lastError}</span>
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
						))}
					</div>
				)}
			</div>
		</div>
	);
}
