import { format } from "date-fns";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { FlaggedPayloadAccessDenied } from "@/components/flagged-payload-access-denied";
import { FlaggedPayloadReportForm } from "@/components/flagged-payload-report-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { getFlaggedPayload } from "@/lib/admin-content-filter";

type Detail = NonNullable<
	Awaited<ReturnType<typeof getFlaggedPayload>>["data"]
>;
type Message = Detail["payload"]["messages"][number];
type Part = Exclude<Message["content"], string>[number];

function formatDate(value: string | null): string {
	return value ? format(new Date(value), "MMM d, yyyy HH:mm:ss") : "—";
}

function stringify(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

// Media is never rendered or fetched: only its hash, type and size were kept,
// and remote URLs are shown as inert text.
function PartView({ part }: { part: Part }) {
	switch (part.type) {
		case "text":
			return <Pre>{part.text ?? ""}</Pre>;
		case "image":
		case "audio":
		case "file":
			return (
				<div className="rounded-md border border-dashed p-2 font-mono text-xs text-muted-foreground">
					[{part.type}
					{part.mimeType ? ` ${part.mimeType}` : ""}
					{part.bytes !== undefined ? `, ${part.bytes} bytes` : ""}
					{part.filename ? `, ${part.filename}` : ""}]
					{part.sha256 ? <div>sha256 {part.sha256}</div> : null}
					{part.url ? <div className="break-all">url {part.url}</div> : null}
					{part.urlSha256 ? <div>url sha256 {part.urlSha256}</div> : null}
					{part.fileId ? <div>file id {part.fileId}</div> : null}
				</div>
			);
		case "tool_use":
			return (
				<Pre>{`tool_use ${part.name ?? ""}\n${stringify(part.input)}`}</Pre>
			);
		case "tool_result":
			return <Pre>{`tool_result\n${stringify(part.content)}`}</Pre>;
		default:
			return (
				<p className="text-xs text-muted-foreground">
					[{part.originalType ?? part.type}]
				</p>
			);
	}
}

function Pre({ children }: { children: string }) {
	return (
		<pre className="max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
			{children}
		</pre>
	);
}

export default async function FlaggedPayloadPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const { data, status } = await getFlaggedPayload(id);
	if (!data) {
		return <FlaggedPayloadAccessDenied status={status} />;
	}
	const { item, payload } = data;
	const scores = Object.entries(item.categoryScores)
		.filter(([, score]) => score >= 0.01)
		.sort(([, a], [, b]) => b - a);

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
						<ShieldAlert className="h-5 w-5" />
					</div>
					<div>
						<h1 className="text-2xl font-semibold tracking-tight">
							Flagged payload
						</h1>
						<p className="font-mono text-xs text-muted-foreground">{item.id}</p>
					</div>
				</div>
				<Button asChild variant="outline" size="sm">
					<Link
						href={`/content-filter/flagged-payloads?orgId=${encodeURIComponent(item.organizationId)}`}
					>
						Back to list
					</Link>
				</Button>
			</header>

			<div
				role="alert"
				className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
			>
				This may contain illegal material. Do not copy, download, forward or
				screenshot it. Report apparent child sexual abuse material to NCMEC
				through the CyberTipline and record the report number below. This view
				was recorded in the platform audit log.
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Request</CardTitle>
					<CardDescription>
						Flagged {formatDate(item.createdAt)} · expires{" "}
						{formatDate(item.expiresAt)}
					</CardDescription>
				</CardHeader>
				<CardContent className="grid gap-2 text-sm sm:grid-cols-2">
					<div>
						Organization:{" "}
						<Link
							href={`/organizations/${item.organizationId}`}
							className="underline"
						>
							{item.organizationName ?? item.organizationId}
						</Link>
					</div>
					<div className="font-mono text-xs">request {item.requestId}</div>
					<div className="font-mono text-xs">project {item.projectId}</div>
					<div className="font-mono text-xs">api key {item.apiKeyId}</div>
					<div>
						{item.endpoint} · {item.provider}/{item.model ?? "—"}
					</div>
					<div>
						{item.classifier} · tier {item.tier} ({item.level}) · {item.action}
					</div>
					<div className="flex flex-wrap gap-1">
						{item.matchedGroups.map((group) => (
							<Badge
								key={group}
								variant={group === "csam" ? "destructive" : "secondary"}
							>
								{group}
							</Badge>
						))}
					</div>
					<div className="text-xs text-muted-foreground">
						{scores
							.map(([category, score]) => `${category} ${score.toFixed(3)}`)
							.join(" · ") || "No category scores"}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>NCMEC report</CardTitle>
					<CardDescription>
						{item.reportedAt
							? `Reported ${formatDate(item.reportedAt)} as ${item.reportReference ?? "—"}`
							: "Not reported"}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<FlaggedPayloadReportForm
						id={item.id}
						reportReference={item.reportReference}
					/>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Payload</CardTitle>
					<CardDescription>
						{item.payloadBytes.toLocaleString()} bytes
						{payload.droppedMessages > 0
							? ` · ${payload.droppedMessages} oldest messages dropped to fit the size cap`
							: ""}
						{item.payloadTruncated && payload.droppedMessages === 0
							? " · truncated"
							: ""}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-4">
					{payload.messages.map((message, index) => (
						<div key={index} className="flex flex-col gap-2">
							<p className="text-xs font-medium uppercase text-muted-foreground">
								{message.role}
								{message.name ? ` (${message.name})` : ""}
							</p>
							{typeof message.content === "string" ? (
								<Pre>{message.content}</Pre>
							) : (
								message.content.map((part, partIndex) => (
									<PartView key={partIndex} part={part} />
								))
							)}
							{message.toolCalls?.map((call, callIndex) => (
								<Pre key={callIndex}>{`${call.name}(${call.arguments})`}</Pre>
							))}
						</div>
					))}
				</CardContent>
			</Card>
		</div>
	);
}
