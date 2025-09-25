"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

export function AuthDialog({ open }: { open: boolean }) {
	if (!open) {
		return null;
	}
	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div className="w-[420px] rounded-md border bg-background p-4 shadow-md">
				<div className="text-sm font-medium mb-2">Sign in required</div>
				<p className="text-sm text-muted-foreground mb-3">
					Please sign in to use the playground and manage your API keys.
				</p>
				<div className="flex items-center justify-end gap-2">
					<Button size="sm" asChild>
						<Link href="/login">Sign in</Link>
					</Button>
					<Button size="sm" variant="outline" asChild>
						<Link href="/signup">Create account</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
