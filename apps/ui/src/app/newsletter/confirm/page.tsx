"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

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

function ConfirmCard() {
	const api = useApi();
	const posthog = usePostHog();
	const token = useSearchParams().get("token") ?? "";
	const confirm = api.useMutation("post", "/public/newsletter/confirm", {
		onSuccess: () => {
			posthog.capture("newsletter_subscribed");
		},
	});

	if (confirm.isSuccess) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>You&apos;re subscribed</CardTitle>
					<CardDescription role="status">
						You&apos;ll get a short email when new models land on LLM Gateway.
						Every issue has an unsubscribe link.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild className="w-full">
						<Link href="/timeline">See the latest releases</Link>
					</Button>
				</CardContent>
			</Card>
		);
	}

	if (!token) {
		return (
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>This link is not valid</CardTitle>
					<CardDescription>
						Open the link from your confirmation email, or sign up again to get
						a new one.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button asChild className="w-full">
						<Link href="/timeline">Sign up again</Link>
					</Button>
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle>Confirm your subscription</CardTitle>
				<CardDescription>
					One click and you&apos;ll get a short email when new models land on
					LLM Gateway.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				<Button
					className="w-full"
					disabled={confirm.isPending}
					onClick={() => confirm.mutate({ body: { token } })}
				>
					{confirm.isPending ? "Confirming…" : "Confirm subscription"}
				</Button>
				{confirm.isError ? (
					<p role="alert" className="text-sm text-destructive">
						{getApiErrorMessage(
							confirm.error,
							"Something went wrong. Please try again.",
						)}{" "}
						<Link href="/timeline" className="underline underline-offset-2">
							Sign up again
						</Link>{" "}
						to get a new&nbsp;link.
					</p>
				) : null}
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
