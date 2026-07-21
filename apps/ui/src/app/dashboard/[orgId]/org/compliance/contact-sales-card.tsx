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
						Compliance
					</h2>
				</div>

				<Card className="max-w-2xl">
					<CardHeader>
						<CardTitle>Enterprise Feature</CardTitle>
						<CardDescription>
							Provider compliance policies are available on the Enterprise plan
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<p className="text-muted-foreground">
							Guarantee that your traffic only ever reaches providers that meet
							your regulatory requirements. Requests to providers without the
							required certifications or data policies are blocked before any
							data leaves the gateway.
						</p>

						<div className="space-y-3">
							<h4 className="font-medium">What&apos;s included:</h4>
							<ul className="space-y-2">
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Require SOC 2 and/or ISO 27001 certified providers
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Require GDPR-compliant providers
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Block providers that train on or log your prompts
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Requests to non-compliant providers are blocked
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Blocks recorded as security events
								</li>
							</ul>
						</div>

						<Button asChild className="gap-2">
							<a href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Compliance">
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
