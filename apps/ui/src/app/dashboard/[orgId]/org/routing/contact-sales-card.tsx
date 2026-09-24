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

export function AutoRoutingContactSalesCard() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Auto Routing
					</h2>
				</div>

				<Card className="max-w-2xl">
					<CardHeader>
						<CardTitle>Enterprise Feature</CardTitle>
						<CardDescription>
							Configurable auto routing is available on the Enterprise plan
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<p className="text-muted-foreground">
							Decide which models the <code className="text-xs">auto</code>{" "}
							model may resolve to, and let a classifier route each request to
							the cheapest model that can actually handle it.
						</p>

						<div className="space-y-3">
							<h4 className="font-medium">What&apos;s included:</h4>
							<ul className="space-y-2">
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Choose your own candidate models for auto routing
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Content-aware routing by request difficulty
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Per-project overrides of the organization default
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Every routing decision recorded on the request log
								</li>
							</ul>
						</div>

						<Button asChild className="gap-2">
							<a href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Auto%20Routing">
								<Mail className="h-4 w-4" />
								Contact Sales
							</a>
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
