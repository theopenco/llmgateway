"use client";

import { CheckCircle, ExternalLink, Mail } from "lucide-react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

export function MasterKeysContactSalesCard() {
	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex items-center justify-between">
					<h2 className="text-2xl md:text-3xl font-bold tracking-tight">
						Master Keys
					</h2>
				</div>

				<Card className="max-w-2xl">
					<CardHeader>
						<CardTitle>Enterprise Feature</CardTitle>
						<CardDescription>
							Master keys are available on the Enterprise plan
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						<p className="text-muted-foreground">
							Provision projects and gateway API keys programmatically from your
							own backend. Master keys are bearer tokens scoped to your
							organization, hashed at rest, and shown to you only once at
							creation time.
						</p>

						<div className="space-y-3">
							<h4 className="font-medium">What&apos;s included:</h4>
							<ul className="space-y-2">
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Programmatic project creation
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Programmatic gateway API key creation
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Bearer-token authentication at /v1/master/*
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									HMAC-SHA256 hashing at rest
								</li>
								<li className="flex items-center gap-2 text-sm text-muted-foreground">
									<CheckCircle className="h-4 w-4 text-primary" />
									Audit logging of every key action
								</li>
							</ul>
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<Button asChild className="gap-2">
								<a href="mailto:contact@llmgateway.io?subject=Enterprise%20Plan%20Inquiry%20-%20Master%20Keys">
									<Mail className="h-4 w-4" />
									Contact Sales
								</a>
							</Button>
							<Button asChild variant="outline" className="gap-2">
								<a
									href="https://docs.llmgateway.io/features/master-keys"
									target="_blank"
									rel="noopener noreferrer"
								>
									View docs
									<ExternalLink className="h-4 w-4" />
								</a>
							</Button>
						</div>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
