import { Check, X } from "lucide-react";
import Link from "next/link";

import { AuthLink } from "@/components/shared/auth-link";
import { Button } from "@/lib/components/button";

import type { ReactNode } from "react";

type FeatureValue = boolean | string;

type ComparisonFeature<K extends string> = {
	title: string;
	description: string;
	llmgateway: FeatureValue;
} & Record<K, FeatureValue>;

export interface ComparisonCategory<K extends string> {
	category: string;
	features: ComparisonFeature<K>[];
}

export interface ComparisonPlan {
	name: string;
	tagline: string;
	price: string;
	note: string;
	icon?: ReactNode;
}

function renderFeatureValue(value: FeatureValue) {
	if (typeof value === "boolean") {
		return value ? (
			<Check className="h-5 w-5 text-green-600 dark:text-green-400" />
		) : (
			<X className="h-5 w-5 text-red-600 dark:text-red-400" />
		);
	}
	return <span className="text-sm font-medium text-foreground">{value}</span>;
}

function PlanCard({
	plan,
	highlighted,
}: {
	plan: ComparisonPlan;
	highlighted: boolean;
}) {
	return (
		<div className="text-center">
			<div
				className={
					highlighted
						? "border-2 border-primary rounded-lg p-4 bg-background shadow-sm h-full"
						: "border border-border rounded-lg p-4 bg-background h-full"
				}
			>
				{plan.icon && (
					<div className="flex justify-center mb-1">{plan.icon}</div>
				)}
				<h3 className="font-bold text-lg mb-1 text-foreground">{plan.name}</h3>
				<p className="text-sm text-muted-foreground mb-2">{plan.tagline}</p>
				<p
					className={`text-2xl font-bold ${highlighted ? "text-primary" : "text-foreground"}`}
				>
					{plan.price}
				</p>
				<p className="text-xs text-muted-foreground mt-1">{plan.note}</p>
			</div>
		</div>
	);
}

export function ComparisonTable<K extends string>({
	llmgateway,
	competitor,
	competitorKey,
	data,
}: {
	llmgateway: Omit<ComparisonPlan, "name">;
	competitor: ComparisonPlan;
	competitorKey: K;
	data: ComparisonCategory<K>[];
}) {
	return (
		<div className="bg-card rounded-lg border border-border overflow-hidden shadow-sm">
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 sm:p-6 bg-muted/50 border-b border-border">
				<div className="hidden md:block" />
				<PlanCard plan={{ ...llmgateway, name: "LLM Gateway" }} highlighted />
				<PlanCard plan={competitor} highlighted={false} />
			</div>

			{data.map((category, categoryIndex) => (
				<div key={category.category}>
					{categoryIndex > 0 && <div className="border-t-2 border-border/50" />}

					{category.features.map((feature) => (
						<div
							key={feature.title}
							className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6 border-b border-border/50 hover:bg-muted/30 transition-colors"
						>
							<div>
								<h4 className="font-semibold text-foreground mb-1">
									{feature.title}
								</h4>
								<p className="text-sm text-muted-foreground">
									{feature.description}
								</p>
							</div>
							<div className="flex items-center gap-2 md:justify-center">
								<span className="text-xs font-medium text-muted-foreground md:hidden">
									LLM Gateway:
								</span>
								{renderFeatureValue(feature.llmgateway)}
							</div>
							<div className="flex items-center gap-2 md:justify-center">
								<span className="text-xs font-medium text-muted-foreground md:hidden">
									{competitor.name}:
								</span>
								{renderFeatureValue(feature[competitorKey])}
							</div>
						</div>
					))}
				</div>
			))}
		</div>
	);
}

export function ComparisonCtas({ children }: { children?: ReactNode }) {
	return (
		<div className="text-center mt-8">
			<div className="flex flex-col sm:flex-row gap-4 justify-center">
				<Button asChild size="lg" className="bg-primary hover:bg-primary/90">
					<AuthLink href="/signup">Start Free with LLM Gateway</AuthLink>
				</Button>
				<Button asChild size="lg" variant="outline">
					<Link href="/pricing">View Pricing Details</Link>
				</Button>
			</div>
			<p className="text-sm text-muted-foreground mt-3">
				No credit card required • Self-host option available • Enterprise
				support available
			</p>
			{children}
		</div>
	);
}
