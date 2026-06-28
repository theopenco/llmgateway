import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent, CardHeader } from "@/lib/components/card";
import { formatDate, isoDate, type TimelineModel } from "@/lib/timeline-data";

import { getModelFamilyIcon } from "@llmgateway/shared/components";

export const GUTTER = "w-10 md:w-14";

export function FamilyMark({ family }: { family: string }) {
	const Icon = getModelFamilyIcon(family);
	return (
		<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/50">
			<Icon className="h-5 w-5" />
		</span>
	);
}

export function ModelFact({ model }: { model: TimelineModel }) {
	return (
		<p className="text-sm leading-relaxed text-muted-foreground">
			<span className="font-medium text-foreground">{model.name}</span> was
			{model.releasedAt ? " released by " : " added by "}
			<span className="font-medium text-foreground">{model.providerName}</span>
			{model.releasedAt ? (
				<>
					{" "}
					on{" "}
					<time
						dateTime={isoDate(model.releasedAt)}
						className="font-medium text-foreground"
					>
						{formatDate(model.releasedAt)}
					</time>
				</>
			) : null}
			{model.addedAt ? (
				<>
					{model.releasedAt ? " and added" : ""} to LLM Gateway on{" "}
					<time
						dateTime={isoDate(model.addedAt)}
						className="font-medium text-foreground"
					>
						{formatDate(model.addedAt)}
					</time>
				</>
			) : null}
			.
		</p>
	);
}

interface ModelCardProps {
	model: TimelineModel;
	latestReleasedAt: string | null;
}

export function ModelCard({ model, latestReleasedAt }: ModelCardProps) {
	return (
		<Card className="group h-full gap-0 border-border/70 bg-card/60 py-4 backdrop-blur transition-all hover:border-primary/40 hover:bg-card hover:shadow-md">
			<CardHeader className="px-4 pb-2">
				<div className="flex items-start gap-3">
					<FamilyMark family={model.family} />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="font-display text-base font-semibold leading-tight md:text-lg">
								{model.name}
							</h3>
							{model.significant ? (
								<Badge
									variant="outline"
									className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-600 dark:text-amber-400"
								>
									Flagship
								</Badge>
							) : null}
							{model.releasedAt && model.releasedAt === latestReleasedAt ? (
								<Badge
									variant="outline"
									className="border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
								>
									Latest
								</Badge>
							) : null}
						</div>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{model.providerName} ·{" "}
							<span className="font-mono text-[11px]">{model.id}</span>
						</p>
					</div>
				</div>
			</CardHeader>
			<CardContent className="px-4">
				<ModelFact model={model} />
				<Button
					asChild
					variant="ghost"
					size="sm"
					className="mt-2 h-auto px-0 text-primary hover:bg-transparent hover:text-primary hover:underline"
				>
					<Link
						href={`/models/${encodeURIComponent(model.id)}`}
						className="inline-flex items-center gap-1 text-xs font-medium"
					>
						View model details
						<ArrowUpRight className="h-3 w-3" />
					</Link>
				</Button>
			</CardContent>
		</Card>
	);
}
