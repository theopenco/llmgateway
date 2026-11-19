import Link from "next/link";

import { Button } from "@/components/ui/button";

export function FlaggedPayloadAccessDenied({ status }: { status: number }) {
	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-16 text-center">
			<h1 className="text-2xl font-semibold tracking-tight">
				{status === 401
					? "Sign in required"
					: status === 404
						? "Flagged payload not found"
						: "Full admin access required"}
			</h1>
			<p className="text-sm text-muted-foreground">
				{status === 404
					? "It may have expired and been deleted."
					: "Flagged payloads are only available to full-access admins."}
			</p>
			{status === 401 ? (
				<Button asChild className="mx-auto w-fit">
					<Link href="/login">Sign In</Link>
				</Button>
			) : null}
		</div>
	);
}
