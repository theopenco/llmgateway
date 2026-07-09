"use client";

import { ChevronDown, Coins, Hash, MoreHorizontal, Zap } from "lucide-react";

import {
	aggregateByDimension,
	currencyFormatter,
	type DimensionRow,
} from "@/components/analytics/chart-helpers";
import { DimensionUsageCard } from "@/components/analytics/dimension-usage-card";
import { DimensionUsageOverTimeCard } from "@/components/analytics/dimension-usage-over-time-card";
import { Badge } from "@/lib/components/badge";
import { Button } from "@/lib/components/button";
import { Card, CardContent } from "@/lib/components/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/lib/components/table";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const numberFormatter = new Intl.NumberFormat("en-US");

const mockProjects = [
	{ key: "prod-api", label: "Production API", base: 168, wave: 24, phase: 0.9 },
	{
		key: "support-bot",
		label: "Support Chatbot",
		base: 84,
		wave: 14,
		phase: 2.1,
	},
	{
		key: "research",
		label: "Research & Evals",
		base: 38,
		wave: 26,
		phase: 4.4,
	},
	{ key: "internal", label: "Internal Tools", base: 15, wave: 5, phase: 6.2 },
];

// Deterministic series (no randomness) so server and client render identically.
function buildMockRows(): DimensionRow[] {
	const rows: DimensionRow[] = [];
	for (let i = 0; i < 30; i++) {
		const date = `2026-06-${String(i + 1).padStart(2, "0")}`;
		const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
		const weekend = weekday === 0 || weekday === 6 ? 0.45 : 1;
		rows.push({
			date,
			breakdown: mockProjects.map((project) => {
				const drift = i * 0.8;
				const noise = Math.sin(drift + project.phase) * project.wave;
				const cost = Math.max(2, (project.base + noise) * weekend);
				return {
					key: project.key,
					label: project.label,
					cost: Math.round(cost * 100) / 100,
					requestCount: Math.round(cost * 420),
					totalTokens: Math.round(cost * 130_000),
				};
			}),
		});
	}
	return rows;
}

const mockRows = buildMockRows();
const mockTotals = aggregateByDimension(mockRows);

function ShowcaseFrame({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-black/10">
			<div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
				<span className="h-3 w-3 rounded-full bg-red-400/70" />
				<span className="h-3 w-3 rounded-full bg-yellow-400/70" />
				<span className="h-3 w-3 rounded-full bg-green-400/70" />
				<span className="ml-3 font-mono text-xs text-muted-foreground">
					{label}
				</span>
				<Badge
					variant="outline"
					className="ml-auto text-[10px] font-normal uppercase tracking-wider"
				>
					Mock data
				</Badge>
			</div>
			<div className="space-y-4 bg-muted/10 p-4 sm:p-6">{children}</div>
		</div>
	);
}

function SummaryStat({
	label,
	value,
	icon: Icon,
}: {
	label: string;
	value: string;
	icon: LucideIcon;
}) {
	return (
		<Card>
			<CardContent className="flex items-center gap-3 p-4">
				<div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-md">
					<Icon className="h-5 w-5" />
				</div>
				<div className="min-w-0">
					<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
						{label}
					</p>
					<p className="truncate text-2xl font-semibold tabular-nums">
						{value}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

function FakeSelect({ children }: { children: ReactNode }) {
	return (
		<div className="inline-flex h-8 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs">
			{children}
			<ChevronDown className="h-4 w-4 opacity-50" />
		</div>
	);
}

function OrgAnalyticsShowcase() {
	return (
		<ShowcaseFrame label="Organization → Analytics">
			<div className="grid gap-4 sm:grid-cols-3">
				<SummaryStat
					label="Total spend"
					value={currencyFormatter.format(mockTotals.totalCost)}
					icon={Coins}
				/>
				<SummaryStat
					label="Requests"
					value={numberFormatter.format(mockTotals.totalRequests)}
					icon={Zap}
				/>
				<SummaryStat
					label="Tokens"
					value={numberFormatter.format(mockTotals.totalTokens)}
					icon={Hash}
				/>
			</div>

			<div className="flex flex-wrap items-center justify-between gap-2">
				<FakeSelect>Jun 1 – Jun 30, 2026</FakeSelect>
				<FakeSelect>Breakdown by project</FakeSelect>
			</div>

			<DimensionUsageOverTimeCard
				rows={mockRows}
				title="Cost by project over time"
				description="Daily usage per project across the organization"
			/>
			<DimensionUsageCard
				rows={mockRows}
				title="Cost by project"
				description="Total usage by project for the selected range"
			/>
		</ShowcaseFrame>
	);
}

interface MockMember {
	name: string;
	email: string;
	role: "owner" | "admin" | "developer";
	projects: string[] | "all";
	limits: string[];
	cost: string;
	tokens: string;
	requests: string;
	apiKeys: number;
}

const mockMembers: MockMember[] = [
	{
		name: "Amira Haddad",
		email: "amira@acme.dev",
		role: "owner",
		projects: "all",
		limits: [],
		cost: "$4,812.40",
		tokens: "625,612,300",
		requests: "2,021,208",
		apiKeys: 6,
	},
	{
		name: "Jonas Weber",
		email: "jonas@acme.dev",
		role: "admin",
		projects: "all",
		limits: [],
		cost: "$2,304.11",
		tokens: "299,534,410",
		requests: "967,726",
		apiKeys: 4,
	},
	{
		name: "Priya Sharma",
		email: "priya@acme.dev",
		role: "developer",
		projects: ["Production API"],
		limits: ["$500.00/month", "3 keys"],
		cost: "$412.86",
		tokens: "53,671,800",
		requests: "173,401",
		apiKeys: 3,
	},
	{
		name: "Marco Rossi",
		email: "marco@acme.dev",
		role: "developer",
		projects: ["Support Chatbot", "Research & Evals"],
		limits: ["$250.00/week", "2 keys"],
		cost: "$189.44",
		tokens: "24,627,200",
		requests: "79,565",
		apiKeys: 2,
	},
	{
		name: "Lena Fischer",
		email: "lena@contractor.io",
		role: "developer",
		projects: ["Research & Evals"],
		limits: ["$100.00 total", "$10.00/day", "1 key"],
		cost: "$96.10",
		tokens: "12,493,000",
		requests: "40,362",
		apiKeys: 1,
	},
];

function MemberBudgetsShowcase() {
	return (
		<ShowcaseFrame label="Organization → Team">
			<Card>
				<CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
					<div>
						<p className="text-sm font-medium">Default developer limits</p>
						<p className="text-muted-foreground text-xs">
							Applied to every developer without a personal override
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant="secondary" className="font-normal">
							$100.00 total
						</Badge>
						<Badge variant="secondary" className="font-normal">
							$25.00/week
						</Badge>
						<Badge variant="secondary" className="font-normal">
							3 keys
						</Badge>
						<Button variant="outline" size="sm">
							Edit defaults
						</Button>
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="overflow-x-auto p-0">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Name</TableHead>
								<TableHead>Role</TableHead>
								<TableHead>Projects</TableHead>
								<TableHead>Limits</TableHead>
								<TableHead className="text-right">Cost</TableHead>
								<TableHead className="text-right">Tokens</TableHead>
								<TableHead className="text-right">Requests</TableHead>
								<TableHead className="text-right">API keys</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{mockMembers.map((member) => (
								<TableRow key={member.email}>
									<TableCell>
										<div className="font-medium">{member.name}</div>
										<div className="text-muted-foreground text-xs">
											{member.email}
										</div>
									</TableCell>
									<TableCell>
										<Badge variant="secondary" className="capitalize">
											{member.role}
										</Badge>
									</TableCell>
									<TableCell>
										{member.projects === "all" ? (
											<span className="text-muted-foreground text-sm">
												All projects
											</span>
										) : (
											<div className="flex flex-wrap gap-1">
												{member.projects.map((project) => (
													<Badge
														key={project}
														variant="outline"
														className="font-normal"
													>
														{project}
													</Badge>
												))}
											</div>
										)}
									</TableCell>
									<TableCell>
										{member.limits.length === 0 ? (
											<span className="text-muted-foreground">—</span>
										) : (
											<div className="flex flex-wrap gap-1">
												{member.limits.map((limit) => (
													<Badge
														key={limit}
														variant="secondary"
														className="font-normal"
													>
														{limit}
													</Badge>
												))}
											</div>
										)}
									</TableCell>
									<TableCell className="text-right font-medium tabular-nums">
										{member.cost}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{member.tokens}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{member.requests}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{member.apiKeys}
									</TableCell>
									<TableCell className="text-right">
										<Button
											variant="ghost"
											size="icon"
											className="h-8 w-8"
											aria-label={`Actions for ${member.name}`}
										>
											<MoreHorizontal className="h-4 w-4" />
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>

			<Card>
				<CardContent className="p-4">
					<p className="text-sm font-medium">Enforced at request time</p>
					<p className="text-muted-foreground mb-3 text-xs">
						An over-budget request is rejected before it reaches a provider.
					</p>
					<pre className="overflow-x-auto rounded-lg bg-muted/60 p-4 font-mono text-xs leading-relaxed">
						{`POST /v1/chat/completions
403 Member has reached their total spend budget.`}
					</pre>
				</CardContent>
			</Card>
		</ShowcaseFrame>
	);
}

const showcases: Record<string, () => ReactNode> = {
	"organization-analytics": OrgAnalyticsShowcase,
	"member-budgets": MemberBudgetsShowcase,
};

export function EnterpriseFeatureShowcase({ slug }: { slug: string }) {
	const Showcase = showcases[slug];
	if (!Showcase) {
		return null;
	}
	return <Showcase />;
}
