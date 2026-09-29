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

export function ContactSalesCard() {
	return (
		<Card className="max-w-2xl">
			<CardHeader>
				<CardTitle>Enterprise Feature</CardTitle>
				<CardDescription>
					Guardrails are available on the Enterprise plan
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<p className="text-muted-foreground">
					Protect your LLM applications with enterprise-grade content safety
					controls. Automatically detect and block prompt injections, jailbreak
					attempts, and sensitive data exposure.
				</p>

				<div className="space-y-3">
					<h4 className="font-medium">What&apos;s included:</h4>
					<ul className="space-y-2">
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Prompt injection and jailbreak detection
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							PII detection with automatic redaction
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Secrets and credentials scanning
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Custom blocked terms and regex patterns
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Topic restriction policies
						</li>
						<li className="flex items-center gap-2 text-sm text-muted-foreground">
							<CheckCircle className="h-4 w-4 text-primary" />
							Real-time security event monitoring
						</li>
					</ul>
				</div>

				<ContactSalesButton />
			</CardContent>
		</Card>
	);
}
