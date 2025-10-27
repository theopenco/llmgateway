"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";

interface AuthDialogProps {
	open: boolean;
	returnUrl?: string;
}

export function AuthDialog({ open, returnUrl }: AuthDialogProps) {
	if (!open) {
		return null;
	}

	const loginUrl = returnUrl
		? `/login?returnUrl=${encodeURIComponent(returnUrl)}`
		: "/login";
	const signupUrl = returnUrl
		? `/signup?returnUrl=${encodeURIComponent(returnUrl)}`
		: "/signup";

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div className="w-[420px] rounded-md border bg-background p-4 shadow-md">
				<div className="text-sm font-medium mb-2">Sign in required</div>
				<p className="text-sm text-muted-foreground mb-3">
					Please sign in to use the playground and manage your API keys.
				</p>
				<div className="flex items-center justify-end gap-2">
					<Button size="sm" asChild>
						<Link href={loginUrl}>Sign in</Link>
					</Button>
					<Button size="sm" variant="outline" asChild>
						<Link href={signupUrl}>Create account</Link>
					</Button>
				</div>
			</div>
		</div>
	);
}
