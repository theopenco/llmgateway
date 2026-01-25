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

export function ContactSalesCard() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Audit Logs
					</h2>
				</div>

				<Card className="max-w-2xl">
					<CardHeader>
						<CardTitle>Enterprise Feature</CardTitle>
						<CardDescription>
							Audit logs are available on the Enterprise plan
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<p className="text-muted-foreground">
							Track all actions taken within your organization with
							comprehensive audit logging. See who did what, when, and maintain
							compliance with your security requirements.
						</p>

						<div className="space-y-3">
							<h4 className="font-medium">What&apos;s included:</h4>
							<ul className="space-y-2">
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Complete activity history for all team members
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Track API key creation, updates, and deletions
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Monitor team membership changes
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									View billing and subscription events
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Filter by user, action type, or date range
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Export logs for compliance requirements
								</li>
							</ul>
						</div>

						<Button asChild className="gap-2">
							<a href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Audit%20Logs">
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
