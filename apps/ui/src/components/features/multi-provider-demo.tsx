"use client";

import { CheckCircle2, Clock, DollarSign } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";

const providers = [
	{
		name: "OpenAI",
		models: 15,
		status: "active",
		latency: 987,
		cost: "$45.23",
	},
	{
		name: "Anthropic",
		models: 8,
		status: "active",
		latency: 1123,
		cost: "$52.18",
	},
	{
		name: "Google AI",
		models: 12,
		status: "active",
		latency: 1456,
		cost: "$18.45",
	},
	{
		name: "Together AI",
		models: 20,
		status: "active",
		latency: 654,
		cost: "$11.57",
	},
	{
		name: "Groq",
		models: 5,
		status: "active",
		latency: 432,
		cost: "$3.42",
	},
	{
		name: "xAI",
		models: 2,
		status: "active",
		latency: 876,
		cost: "$8.21",
	},
];

export function MultiProviderDemo() {
	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>Connected Providers</CardTitle>
					<CardDescription>
						Access 100+ models from 19+ providers through a single API
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{providers.map((provider) => (
							<div
								key={provider.name}
								className="p-4 rounded-lg border bg-card hover:shadow-md transition-shadow"
							>
								<div className="flex items-start justify-between mb-3">
									<div>
										<p className="font-semibold">{provider.name}</p>
										<p className="text-sm text-muted-foreground">
											{provider.models} models
										</p>
									</div>
									<Badge
										variant="outline"
										className="flex items-center gap-1 text-green-600 border-green-600"
									>
										<CheckCircle2 className="h-3 w-3" />
										{provider.status}
									</Badge>
								</div>

								<div className="space-y-2 text-sm">
									<div className="flex items-center justify-between">
										<span className="flex items-center gap-1 text-muted-foreground">
											<Clock className="h-3 w-3" />
											Avg Latency
										</span>
										<span className="font-medium">{provider.latency}ms</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="flex items-center gap-1 text-muted-foreground">
											<DollarSign className="h-3 w-3" />
											Total Spend
										</span>
										<span className="font-medium">{provider.cost}</span>
									</div>
								</div>
							</div>
						))}
					</div>
				</CardContent>
			</Card>

			<div className="grid gap-4 md:grid-cols-3">
				<Card>
					<CardHeader>
						<CardTitle className="text-4xl font-bold text-center">
							19+
						</CardTitle>
						<CardDescription className="text-center">
							Provider Integrations
						</CardDescription>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-4xl font-bold text-center">
							100+
						</CardTitle>
						<CardDescription className="text-center">
							Available Models
						</CardDescription>
					</CardHeader>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle className="text-4xl font-bold text-center">1</CardTitle>
						<CardDescription className="text-center">
							Unified API
						</CardDescription>
					</CardHeader>
				</Card>
			</div>
		</div>
	);
}
