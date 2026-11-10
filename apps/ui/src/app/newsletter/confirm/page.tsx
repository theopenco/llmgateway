"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { getApiErrorMessage } from "@/lib/api-error";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Skeleton } from "@/lib/components/skeleton";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";
import { cn } from "@/lib/utils";

function ConfirmCard() {
	const api = useApi();
	const posthog = usePostHog();
	const token = useSearchParams().get("token") ?? "";
	const statusRef = useRef<HTMLDivElement>(null);
	const confirm = api.useMutation("post", "/public/newsletter/confirm", {
		onSuccess: () => {
			posthog.capture("newsletter_subscribed");
		},
		// The status line shows the error; this replaces the default toast.
		onError: () => undefined,
	});
	const done = confirm.isSuccess;
	const failed = confirm.isError;
	// Only a rejected link needs a new one; after any other error it still works.
	const invalidLink =
		!token || (confirm.error !== null && "invalidLink" in confirm.error);

	// After the render, so a screen reader lands on the outcome.
	useEffect(() => {
		if (done || failed) {
			statusRef.current?.focus();
		}
	}, [done, failed]);

	let message =
		"One click and you'll get a short email when new models land on LLM Gateway.";
	if (done) {
		message =
			"You'll get a short email when new models land on LLM Gateway. Every issue has an unsubscribe link.";
	} else if (!token) {
		message =
			"Open the link from your confirmation email, or sign up again to get a new one.";
	} else if (failed) {
		message = getApiErrorMessage(
			confirm.error,
			"Something went wrong. Please try again.",
		);
	}

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle role="heading" aria-level={1}>
					{done
						? "You're subscribed"
						: token
							? "Confirm your subscription"
							: "This link is not valid"}
				</CardTitle>
				{/* Always mounted, so screen readers announce the outcome. */}
				<CardDescription
					ref={statusRef}
					role="status"
					tabIndex={-1}
					className={cn(
						"rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
						failed && "text-destructive",
					)}
				>
					{message}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{done ? (
					<Button asChild className="w-full">
						<Link href="/timeline">See the latest releases</Link>
					</Button>
				) : invalidLink ? (
					<Button asChild className="w-full">
						<Link href="/timeline">Sign up again</Link>
					</Button>
				) : (
					<Button
						className="w-full"
						disabled={confirm.isPending}
						onClick={() => confirm.mutate({ body: { token } })}
					>
						{confirm.isPending
							? "Confirming…"
							: failed
								? "Try again"
								: "Confirm subscription"}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

export default function NewsletterConfirmPage() {
	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<Suspense fallback={<Skeleton className="h-48 w-full max-w-md" />}>
				<ConfirmCard />
			</Suspense>
		</main>
	);
}
