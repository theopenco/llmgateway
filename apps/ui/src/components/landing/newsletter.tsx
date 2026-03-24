"use client";

import { CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { useApi } from "@/lib/fetch-client";

export function Newsletter() {
	const [email, setEmail] = useState("");
	const api = useApi();

	const subscribe = api.useMutation("post", "/public/newsletter/subscribe");

	if (subscribe.isSuccess) {
		return (
			<div className="flex flex-col items-center gap-4 py-12">
				<CheckCircle2 className="h-10 w-10 text-green-500" />
				<h3 className="text-xl font-semibold">You're subscribed!</h3>
				<p className="text-muted-foreground text-sm">
					{subscribe.data?.message ??
						"Thanks for subscribing to our newsletter."}
				</p>
			</div>
		);
	}

	return (
		<div className="flex flex-col items-center gap-4 py-12">
			<h3 className="text-xl font-semibold">Stay in the loop</h3>
			<p className="text-muted-foreground text-sm max-w-md text-center">
				Get product updates, new features, and tips delivered to your inbox.
			</p>
			<form
				className="flex w-full max-w-sm gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					subscribe.mutate({ body: { email } });
				}}
			>
				<Input
					type="email"
					placeholder="you@example.com"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
				/>
				<Button type="submit" disabled={subscribe.isPending}>
					{subscribe.isPending ? "Subscribing..." : "Subscribe"}
				</Button>
			</form>
			{subscribe.isError && (
				<p className="text-sm text-destructive">
					{(subscribe.error as { message?: string })?.message ??
						"Something went wrong. Please try again."}
				</p>
			)}
		</div>
	);
}
