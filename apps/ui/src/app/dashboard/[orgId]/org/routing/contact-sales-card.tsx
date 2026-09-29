"use client";

import { CheckCircle } from "lucide-react";

import { ContactSalesButton } from "@/components/contact-sales";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export function SmartRoutingContactSalesCard() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Smart Routing
					</h2>
				</div>

				<Card className="max-w-2xl">
					<CardHeader>
						<CardTitle>Enterprise Feature</CardTitle>
						<CardDescription>
							Smart routing is available on the Enterprise plan
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
									Choose your own candidate models for smart routing
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

						<ContactSalesButton />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
