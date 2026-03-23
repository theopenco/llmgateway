"use client";

import { ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { useState } from "react";

import { useAppConfig } from "@/lib/config";

export default function Newsletter() {
	const config = useAppConfig();
	const [email, setEmail] = useState("");
	const [status, setStatus] = useState<
		"idle" | "loading" | "success" | "error"
	>("idle");
	const [message, setMessage] = useState("");

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!email || status === "loading") {
			return;
		}

		setStatus("loading");
		try {
			const res = await fetch(`${config.apiUrl}/public/newsletter/subscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email }),
			});
			const data = await res.json();

			if (data.success) {
				setStatus("success");
				setMessage(data.message);
				setEmail("");
			} else {
				setStatus("error");
				setMessage(data.message);
			}
		} catch {
			setStatus("error");
			setMessage("Something went wrong. Please try again.");
		}
	}

	return (
		<div className="border-b border-border/50 pb-10 mb-10">
			<div className="max-w-xl">
				<h3 className="font-display text-lg font-semibold tracking-tight text-foreground">
					Stay in the loop
				</h3>
				<p className="mt-1.5 text-sm text-muted-foreground">
					New models, provider updates, and engineering deep-dives. No spam.
				</p>

				{status === "success" ? (
					<div className="mt-4 flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
						<CheckCircle2 className="h-4 w-4" />
						<span>{message}</span>
					</div>
				) : (
					<form
						onSubmit={handleSubmit}
						className="mt-4 flex items-center gap-2"
					>
						<div className="relative flex-1 max-w-sm">
							<input
								type="email"
								value={email}
								onChange={(e) => {
									setEmail(e.target.value);
									if (status === "error") {
										setStatus("idle");
									}
								}}
								placeholder="you@company.com"
								required
								className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30"
							/>
						</div>
						<button
							type="submit"
							disabled={status === "loading"}
							className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none"
						>
							{status === "loading" ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<>
									Subscribe
									<ArrowRight className="h-3.5 w-3.5" />
								</>
							)}
						</button>
					</form>
				)}
				{status === "error" && message && (
					<p className="mt-2 text-xs text-destructive-foreground">{message}</p>
				)}
			</div>
		</div>
	);
}
