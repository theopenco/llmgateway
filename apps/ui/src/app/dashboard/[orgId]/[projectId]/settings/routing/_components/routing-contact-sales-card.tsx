"use client";

import { CheckCircle, Mail } from "lucide-react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export function RoutingContactSalesCard() {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Enterprise Feature</CardTitle>
				<CardDescription>
					Routing overrides are available on the Enterprise plan
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<p className="text-muted-foreground">
					Tune how the gateway routes requests to providers for this project.
					Override the scoring weights, thresholds, retry policy, timeouts, and
					per-provider priorities to match the workload.
				</p>

				<div className="space-y-3">
					<h4 className="font-medium">What&apos;s included:</h4>
					<ul className="space-y-2">
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Custom scoring weights for price, uptime, throughput, latency, and
							prompt caching
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Per-provider routing priorities (or fully exclude a provider)
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Custom exploration rate and low-uptime fallback threshold
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Per-project gateway and upstream request timeouts
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Configurable max retries for cross-provider fallback
						</li>
					</ul>
				</div>

				<Button asChild className="gap-2">
					<a href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Routing">
						<Mail className="h-4 w-4" />
						Contact Sales
					</a>
				</Button>
			</CardContent>
		</Card>
	);
}
