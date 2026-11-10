"use client";

import { Check } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";

export function NewModelsSignup() {
	const [email, setEmail] = useState("");
	const inputId = useId();
	const api = useApi();
	const posthog = usePostHog();
	const subscribe = api.useMutation("post", "/public/newsletter/subscribe", {
		onSuccess: () => {
			posthog.capture("newsletter_subscribed", { placement: "timeline_hero" });
		},
	});

	if (subscribe.isSuccess) {
		return (
			<p
				role="status"
				className="mx-auto flex w-fit items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-300"
			>
				<Check className="h-4 w-4" />
				{subscribe.data?.message ?? "You're subscribed."}
			</p>
		);
	}

	return (
		<div className="mx-auto w-full max-w-md space-y-2">
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
			{subscribe.isError ? (
				<p role="alert" className="text-xs text-destructive">
					{(subscribe.error as { message?: string })?.message ??
						"Something went wrong. Please try again."}
				</p>
			) : (
				<p className="text-xs text-muted-foreground">
					A short roundup when new models land. Unsubscribe anytime.
				</p>
			)}
		</div>
	);
}
