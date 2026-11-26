"use client";

import { ArrowUpRight, Building2, Check, PlaneTakeoff } from "lucide-react";

import { Button } from "@/lib/components/button";
import { Label } from "@/lib/components/label";
import { RadioGroup, RadioGroupItem } from "@/lib/components/radio-group";
import { usePostHog } from "@/lib/posthog";

export type ContactAudience = "company" | "provider";

const AIRSIDE_URL = "https://airside.llmgateway.io";
const AIRSIDE_GUIDE_URL = `${AIRSIDE_URL}/guides/list-your-llm-api`;

const audiences = [
	{
		value: "company",
		icon: Building2,
		title: "Using LLM Gateway at my company",
		description:
			"SSO, audit logs, compliance, self-hosting, or volume pricing.",
	},
	{
		value: "provider",
		icon: PlaneTakeoff,
		title: "Listing my models as a provider",
		description: "You run inference and want traffic from LLM Gateway.",
	},
] as const;

const airsideSteps = [
	"Sign up with your company email to claim your listing, or register a new carrier.",
	"Register models, file your prices, and verify your endpoint live.",
	"Every claim is reviewed by our team, and each new carrier gets a shared Slack channel with us.",
];

function isContactAudience(value: string): value is ContactAudience {
	return audiences.some((audience) => audience.value === value);
}

export function ContactAudiencePicker({
	value,
	onChange,
}: {
	value: ContactAudience;
	onChange: (value: ContactAudience) => void;
}) {
	const posthog = usePostHog();

	return (
		<div className="space-y-3">
			<p id="contact-audience-label" className="text-sm font-medium">
				What brings you here?
			</p>
			<RadioGroup
				value={value}
				onValueChange={(next) => {
					if (!isContactAudience(next)) {
						return;
					}
					posthog.capture("enterprise_contact_audience_selected", {
						audience: next,
					});
					onChange(next);
				}}
				aria-labelledby="contact-audience-label"
				className="grid gap-3 sm:grid-cols-2"
			>
				{audiences.map((audience) => (
					<Label
						key={audience.value}
						htmlFor={`contact-audience-${audience.value}`}
						className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-foreground/30 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
					>
						<RadioGroupItem
							id={`contact-audience-${audience.value}`}
							value={audience.value}
							className="mt-0.5"
						/>
						<span className="space-y-1">
							<span className="flex items-center gap-2 text-sm font-medium leading-snug">
								<audience.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
								{audience.title}
							</span>
							<span className="block text-sm font-normal leading-relaxed text-muted-foreground">
								{audience.description}
							</span>
						</span>
					</Label>
				))}
			</RadioGroup>
		</div>
	);
}

export function AirsideRedirect() {
	const posthog = usePostHog();

	const track = (target: "console" | "guide") => {
		posthog.capture("enterprise_contact_airside_clicked", { target });
	};

	return (
		<div className="rounded-xl border border-border bg-muted/40 p-6 sm:p-8">
			<div className="flex flex-col gap-5 sm:flex-row sm:items-start">
				<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
					<PlaneTakeoff className="h-5 w-5 text-primary" />
				</div>
				<div className="space-y-4">
					<div className="space-y-2">
						<h3 className="text-xl font-semibold tracking-tight">
							Providers list through Airside, not Enterprise
						</h3>
						<p className="leading-relaxed text-muted-foreground">
							Enterprise is for companies that use LLM Gateway. To put your
							models in front of developers on LLM Gateway, use Airside, our
							self-serve provider portal. There is no sales call to book.
						</p>
					</div>
					<ul className="space-y-2">
						{airsideSteps.map((step) => (
							<li key={step} className="flex items-start gap-2.5 text-sm">
								<Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
								<span className="leading-relaxed">{step}</span>
							</li>
						))}
					</ul>
					<div className="flex flex-col gap-3 pt-1 sm:flex-row">
						<Button asChild size="lg">
							<a href={AIRSIDE_URL} onClick={() => track("console")}>
								Claim your listing on Airside
								<ArrowUpRight className="ml-2 h-4 w-4" />
							</a>
						</Button>
						<Button asChild size="lg" variant="outline">
							<a href={AIRSIDE_GUIDE_URL} onClick={() => track("guide")}>
								Read the listing guide
							</a>
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
}
