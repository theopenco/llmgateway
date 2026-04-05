import { ChevronLeft, ChevronRight, MessageCircle, Search } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { requireSession } from "@/lib/require-session";
import { createServerApiClient } from "@/lib/server-api";

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export default async function ChatSupportLogsPage({
	searchParams,
}: {
	searchParams?: Promise<{
		page?: string;
		search?: string;
	}>;
}) {
	await requireSession();

	const params = await searchParams;
	const page = Math.max(1, parseInt(params?.page ?? "1", 10));
	const search = params?.search ?? "";
	const limit = 25;
	const offset = (page - 1) * limit;

	const $api = await createServerApiClient();
	const { data } = await $api.GET("/admin/chat-support-logs", {
		params: {
			query: {
				limit,
				offset,
				search: search || undefined,
			},
		},
	});

	if (!data) {
		return (
			<div className="flex min-h-screen items-center justify-center px-4">
				<div className="w-full max-w-md text-center">
					<h1 className="text-3xl font-semibold tracking-tight">
						Admin Dashboard
					</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						Sign in to access the admin dashboard
					</p>
					<Button asChild size="lg" className="mt-6 w-full">
						<Link href="/login">Sign In</Link>
					</Button>
				</div>
			</div>
		);
	}

	const totalPages = Math.ceil(data.total / limit);

	async function handleSearch(formData: FormData) {
		"use server";
		const searchValue = formData.get("search") as string;
		const searchParam = searchValue
			? `&search=${encodeURIComponent(searchValue)}`
			: "";
		redirect(`/chat-support-logs?page=1${searchParam}`);
	}

	return (
		<div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-8 md:px-8">
			<header className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						Chat Support Logs
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{data.total} conversations found
					</p>
				</div>
				<form
					action={handleSearch}
					className="flex w-full items-center gap-2 sm:w-auto"
				>
					<div className="relative flex-1 sm:flex-initial">
						<Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							name="search"
							placeholder="Search messages..."
							defaultValue={search}
							className="h-9 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-64"
						/>
					</div>
					<Button type="submit" size="sm">
						Search
					</Button>
				</form>
			</header>

			<div className="overflow-x-auto rounded-lg border border-border/60 bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>First Message</TableHead>
							<TableHead>Messages</TableHead>
							<TableHead>IP Address</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.conversations.length === 0 ? (
							<TableRow>
								<TableCell
									colSpan={4}
									className="h-24 text-center text-muted-foreground"
								>
									No conversations found
								</TableCell>
							</TableRow>
						) : (
							data.conversations.map((conv) => (
								<TableRow
									key={conv.id}
									className="cursor-pointer hover:bg-muted/50"
								>
									<TableCell className="text-muted-foreground">
										{formatDate(conv.createdAt)}
									</TableCell>
									<TableCell className="max-w-md">
										<Link
											href={`/chat-support-logs/${conv.id}`}
											className="flex items-center gap-2 hover:underline"
										>
											<MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
											<span className="truncate">
												{conv.firstMessage ?? "No messages"}
											</span>
										</Link>
									</TableCell>
									<TableCell>
										<Badge variant="secondary">{conv.messageCount}</Badge>
									</TableCell>
									<TableCell className="text-xs text-muted-foreground">
										{conv.ipAddress ?? "—"}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			{totalPages > 1 && (
				<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						Showing {offset + 1} to {Math.min(offset + limit, data.total)} of{" "}
						{data.total}
					</p>
					<div className="flex items-center gap-2">
						<Button variant="outline" size="sm" asChild disabled={page <= 1}>
							<Link
								href={`/chat-support-logs?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
								className={page <= 1 ? "pointer-events-none opacity-50" : ""}
							>
								<ChevronLeft className="h-4 w-4" />
								Previous
							</Link>
						</Button>
						<span className="text-sm text-muted-foreground">
							Page {page} of {totalPages}
						</span>
						<Button
							variant="outline"
							size="sm"
							asChild
							disabled={page >= totalPages}
						>
							<Link
								href={`/chat-support-logs?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
								className={
									page >= totalPages ? "pointer-events-none opacity-50" : ""
								}
							>
								Next
								<ChevronRight className="h-4 w-4" />
							</Link>
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
