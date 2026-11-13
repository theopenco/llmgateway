"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { CalendlyInline } from "@/components/enterprise/calendly-inline";
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

import { ENTERPRISE_BOOKING_URL } from "@llmgateway/shared";

function ConfirmCard() {
	const api = useApi();
	const posthog = usePostHog();
	const token = useSearchParams().get("token") ?? "";
	const statusRef = useRef<HTMLDivElement>(null);
	// A click, not an effect: mail scanners that open links must not confirm.
	const confirm = api.useMutation(
		"post",
		"/public/contact/enterprise/confirm",
		{
			onSuccess: () => {
				posthog.capture("enterprise_contact_confirmed");
			},
			// The status line shows the error; this replaces the default toast.
			onError: () => undefined,
		},
	);
	const done = confirm.isSuccess;
	const failed = confirm.isError;
	// Only a rejected link needs a new request; after any other error it still works.
	const invalidLink =
		!token ||
		(typeof confirm.error === "object" &&
			confirm.error !== null &&
			"invalidLink" in confirm.error);

	// After the render, so a screen reader lands on the outcome.
	useEffect(() => {
		if (done || failed) {
			statusRef.current?.focus();
		}
	}, [done, failed]);

	let message =
		"Confirm your email address to send your request to our team and book a call.";
	if (done) {
		message =
			"Your request is with our team. Pick a time below, or we'll reply within 24 hours.";
	} else if (!token) {
		message =
			"Open the link from your confirmation email, or send the contact form again to get a new one.";
	} else if (failed) {
		message = getApiErrorMessage(
			confirm.error,
			"Something went wrong. Please try again.",
		);
	}

	return (
		<Card className={cn("w-full", done ? "max-w-4xl" : "max-w-md")}>
			<CardHeader>
				<CardTitle role="heading" aria-level={1}>
					{done
						? "Email confirmed — book a call"
						: token
							? "Confirm your email"
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
					<CalendlyInline
						url={ENTERPRISE_BOOKING_URL}
						name={confirm.data.name}
						email={confirm.data.email}
					/>
				) : invalidLink ? (
					<Button asChild className="w-full">
						<Link href="/enterprise#contact">Contact sales again</Link>
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
								: "Confirm email and book a call"}
					</Button>
				)}
			</CardContent>
		</Card>
	);
}

export default function EnterpriseConfirmPage() {
	return (
		<main className="flex min-h-screen items-center justify-center p-6">
			<Suspense fallback={<Skeleton className="h-48 w-full max-w-md" />}>
				<ConfirmCard />
			</Suspense>
		</main>
	);
}
