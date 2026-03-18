"use client";

import { Coins, Sparkles, X } from "lucide-react";
import { useState } from "react";

import { TopUpCreditsDialog } from "@/components/credits/top-up-credits-dialog";
import { Button } from "@/lib/components/button";

export function CreditsRecommendationBanner() {
	const [dismissed, setDismissed] = useState(false);

	if (dismissed) {
		return null;
	}

	return (
		<div className="relative overflow-hidden rounded-lg border border-blue-500/20 bg-linear-to-r from-blue-500/10 via-indigo-500/10 to-violet-500/10 p-4">
			<div className="flex items-start gap-4">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/15">
					<Coins className="h-5 w-5 text-blue-600 dark:text-blue-400" />
				</div>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 mb-1">
						<h3 className="font-semibold text-blue-700 dark:text-blue-300">
							Use credits instead
						</h3>
						<span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
							<Sparkles className="h-3 w-3" />
							Recommended
						</span>
					</div>
					<p className="text-sm text-muted-foreground">
						Skip the hassle of managing provider keys. Buy credits and get
						instant access to all models through a single API — with built-in
						fallbacks, load balancing, and usage analytics.
					</p>
					<div className="mt-3">
						<TopUpCreditsDialog>
							<Button
								size="sm"
								className="bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
							>
								<Coins className="mr-2 h-3.5 w-3.5" />
								Buy Credits
							</Button>
						</TopUpCreditsDialog>
					</div>
				</div>
				<button
					type="button"
					onClick={() => setDismissed(true)}
					className="shrink-0 rounded-md p-1 text-muted-foreground/60 transition-colors hover:bg-blue-500/10 hover:text-muted-foreground"
				>
					<X className="h-4 w-4" />
					<span className="sr-only">Dismiss</span>
				</button>
			</div>
		</div>
	);
}
