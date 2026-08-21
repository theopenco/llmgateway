import { Code, Loader2, LogOut } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

import AgentDetailClient from "./AgentDetailClient";

import type { Metadata } from "next";

export const metadata: Metadata = {
	title: "Coding agent",
};

export default async function AgentDetailPage({
	params,
}: {
	params: Promise<{ agentId: string }>;
}) {
	const { agentId } = await params;

	return (
		<div className="min-h-screen bg-background">
			<header className="border-b border-border/50">
				<div className="container mx-auto flex items-center justify-between px-4 py-3">
					<Link href="/" className="flex items-center gap-2">
						<Code className="h-5 w-5" />
						<span className="font-semibold">DevPass</span>
					</Link>
					<Link
						href="/dashboard"
						className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
					>
						<LogOut className="h-3.5 w-3.5 rotate-180" />
						<span className="hidden sm:inline">Dashboard</span>
					</Link>
				</div>
			</header>
			<main className="container mx-auto max-w-6xl px-4 py-8">
				<Suspense
					fallback={
						<div className="flex h-[360px] items-center justify-center rounded-xl border bg-card/50">
							<Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
						</div>
					}
				>
					<AgentDetailClient agentId={agentId} />
				</Suspense>
			</main>
		</div>
	);
}
