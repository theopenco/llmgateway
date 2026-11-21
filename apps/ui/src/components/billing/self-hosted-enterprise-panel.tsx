"use client";

import { Check } from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { Textarea } from "@/lib/components/textarea";
import { useAppConfig } from "@/lib/config";
import { useDashboardState } from "@/lib/dashboard-state";
import { useApi } from "@/lib/fetch-client";
import { usePostHog } from "@/lib/posthog";

const ENTERPRISE_FEATURES = [
	"SSO and audit logs",
	"Provider compliance policies",
	"Guardrails and custom models",
	"Priority support with an SLA",
];

const TEAM_SIZES = [
	"1-5",
	"6-10",
	"11-25",
	"26-50",
	"51-200",
	"201-500",
	"501-1000",
	"1000+",
];

/**
 * Shown on self-hosted installations without an enterprise plan: explains the
 * enterprise licence and lets the operator ask for it with a work email.
 */
export function SelfHostedEnterprisePanel() {
	const { hosted } = useAppConfig();
	const { selectedOrganization } = useDashboardState();
	const api = useApi();
	const posthog = usePostHog();
	const [email, setEmail] = useState("");
	const [size, setSize] = useState("");
	const [message, setMessage] = useState("");

	const register = api.useMutation("post", "/installation/register", {
		onSuccess: () => {
			posthog.capture("self_hosted_enterprise_registered", { size });
		},
	});

	if (
		hosted ||
		!selectedOrganization ||
		selectedOrganization.plan === "enterprise"
	) {
		return null;
	}

	const errorMessage = register.isError
		? "The registration could not be sent. Try again, or email contact@llmgateway.io."
		: null;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Enterprise for self-hosted</CardTitle>
				<CardDescription>
					This installation runs the open-source edition. An enterprise licence
					adds the features below to your own deployment.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<ul className="grid gap-2 text-sm sm:grid-cols-2">
					{ENTERPRISE_FEATURES.map((feature) => (
						<li key={feature} className="flex items-center gap-2">
							<Check aria-hidden className="size-4 text-green-600" />
							{feature}
						</li>
					))}
				</ul>
				{register.isSuccess ? (
					<p role="status" className="rounded-lg border p-4 text-sm">
						Sent. Open the confirmation email we sent to {email} and we will
						reply with licence options.
					</p>
				) : (
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							register.mutate({
								body: {
									email: email.trim(),
									size,
									...(message.trim() ? { message: message.trim() } : {}),
								},
							});
						}}
					>
						<div className="grid gap-4 sm:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="self-hosted-enterprise-email">Work email</Label>
								<Input
									id="self-hosted-enterprise-email"
									type="email"
									autoComplete="email"
									required
									placeholder="you@company.com"
									value={email}
									onChange={(event) => setEmail(event.target.value)}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="self-hosted-enterprise-size">Team size</Label>
								<Select value={size} onValueChange={setSize} required>
									<SelectTrigger
										id="self-hosted-enterprise-size"
										className="w-full"
									>
										<SelectValue placeholder="Select a size" />
									</SelectTrigger>
									<SelectContent>
										{TEAM_SIZES.map((option) => (
											<SelectItem key={option} value={option}>
												{option}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="self-hosted-enterprise-message">
								What do you need? (optional)
							</Label>
							<Textarea
								id="self-hosted-enterprise-message"
								maxLength={2000}
								rows={3}
								value={message}
								onChange={(event) => setMessage(event.target.value)}
							/>
						</div>
						{errorMessage && (
							<p role="alert" className="text-sm text-destructive">
								{errorMessage}
							</p>
						)}
						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" disabled={register.isPending || !size}>
								{register.isPending ? "Sending..." : "Register this install"}
							</Button>
							<p className="text-xs text-muted-foreground">
								Sends this email, team size, note and the installed version to
								LLM Gateway. Nothing else leaves your deployment.
							</p>
						</div>
					</form>
				)}
			</CardContent>
		</Card>
	);
}
