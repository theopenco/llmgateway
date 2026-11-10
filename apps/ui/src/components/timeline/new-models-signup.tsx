"use client";

import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { getApiErrorMessage } from "@/lib/api-error";
import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";
import { cn } from "@/lib/utils";

export function NewModelsSignup() {
	const [email, setEmail] = useState("");
	const inputId = useId();
	const statusRef = useRef<HTMLParagraphElement>(null);
	const api = useApi();
	const posthog = usePostHog();
	const subscribe = api.useMutation("post", "/public/newsletter/subscribe", {
		onSuccess: () => {
			posthog.capture("newsletter_signup_requested", {
				placement: "timeline_hero",
			});
		},
		// The status line shows the error; this replaces the default toast.
		onError: () => undefined,
	});
	const sent = subscribe.isSuccess;
	// After the render, so a screen reader lands on the new message.
	useEffect(() => {
		if (sent) {
			statusRef.current?.focus();
		}
	}, [sent]);

	// The status line is always mounted so screen readers announce its changes,
	// and the block keeps the form's height so the page below does not jump.
	return (
		<div className="mx-auto flex min-h-28 w-full max-w-md flex-col justify-center gap-2 sm:min-h-16">
			{sent ? null : (
				<form
					className="flex flex-col gap-2 sm:flex-row"
					onSubmit={(event) => {
						event.preventDefault();
						if (!subscribe.isPending) {
							subscribe.mutate({ body: { email } });
						}
					}}
				>
					<label htmlFor={inputId} className="sr-only">
						Email address
					</label>
					<Input
						id={inputId}
						type="email"
						required
						autoComplete="email"
						placeholder="you@company.com"
						value={email}
						onChange={(event) => setEmail(event.target.value)}
						className="h-10 bg-background/80"
					/>
					<Button
						type="submit"
						disabled={subscribe.isPending}
						className="h-10 shrink-0"
					>
						{subscribe.isPending ? "Subscribing..." : "Get new models by email"}
					</Button>
				</form>
			)}
			<p
				ref={statusRef}
				role="status"
				tabIndex={-1}
				className={cn(
					"outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
					sent
						? "mx-auto flex w-fit items-center gap-2 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 sm:rounded-full dark:text-emerald-300"
						: "rounded-sm text-xs",
					!sent &&
						(subscribe.isError ? "text-destructive" : "text-muted-foreground"),
				)}
			>
				{sent ? <Check className="h-4 w-4" aria-hidden /> : null}
				{sent
					? (subscribe.data?.message ??
						"Check your inbox to confirm your subscription.")
					: subscribe.isError
						? getApiErrorMessage(
								subscribe.error,
								"Something went wrong. Please try again.",
							)
						: "A short roundup when new models land. Unsubscribe anytime."}
			</p>
		</div>
	);
}
