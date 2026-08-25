"use client";

import { MessagesSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAppConfig } from "@/lib/config";

/**
 * Post-signup Slack invite: every carrier gets a shared Slack Connect
 * channel with our team for launch coordination and claim review.
 */
export function SlackCard() {
	const config = useAppConfig();

	return (
		<section
			className="border-border bg-card rounded-xl border p-6"
			data-testid="slack-card"
		>
			<div className="flex flex-wrap items-center justify-between gap-4">
				<div className="flex items-center gap-3">
					<MessagesSquare className="text-primary size-5 shrink-0" />
					<div>
						<h2 className="font-display font-bold">Join the crew channel</h2>
						<p className="text-muted-foreground text-sm">
							Every carrier gets a cross-team Slack Connect channel with our
							crew — claim reviews, tariff questions, launch coordination.
						</p>
					</div>
				</div>
				<Button asChild variant="outline" className="font-semibold">
					<a href={config.slackUrl} target="_blank" rel="noopener noreferrer">
						Join our Slack
					</a>
				</Button>
			</div>
		</section>
	);
}
