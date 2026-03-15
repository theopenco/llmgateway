"use client";

import { useState } from "react";

import { Badge } from "@/lib/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";
import { Slider } from "@/lib/components/slider";

function formatCurrency(value: number): string {
	return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function CostCalculator({ discount }: { discount: number }) {
	const [monthlySpend, setMonthlySpend] = useState(72000);

	// eslint-disable-next-line no-mixed-operators
	const multiplier = 1 - discount / 100;
	const gatewayTotal = monthlySpend * multiplier;
	const savings = monthlySpend - gatewayTotal;

	return (
		<section className="w-full py-12 md:py-16">
			<div className="container mx-auto px-4 md:px-6 max-w-4xl">
				<div className="space-y-8">
					<div className="space-y-3">
						<div className="flex items-center justify-between gap-4">
							<Label>Estimated monthly spend on Google AI Studio</Label>
							<div className="relative">
								<span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
									$
								</span>
								<Input
									type="number"
									value={monthlySpend}
									min={100}
									max={500000}
									step={100}
									onChange={(e) => {
										const parsed = parseFloat(e.target.value);
										if (!isNaN(parsed)) {
											setMonthlySpend(Math.min(500000, Math.max(100, parsed)));
										}
									}}
									className="w-36 text-right pl-7"
								/>
							</div>
						</div>
						<Slider
							value={[monthlySpend]}
							min={100}
							max={500000}
							step={100}
							onValueChange={([v]) => {
								if (v !== undefined) {
									setMonthlySpend(v);
								}
							}}
						/>
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>$100</span>
							<span>$500,000</span>
						</div>
					</div>

					<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
						<Card>
							<CardHeader>
								<CardDescription>Google AI Studio Direct</CardDescription>
								<CardTitle className="text-2xl">
									{formatCurrency(monthlySpend)}
									<span className="text-sm font-normal text-muted-foreground">
										/mo
									</span>
								</CardTitle>
							</CardHeader>
							<CardContent className="text-sm text-muted-foreground">
								Full price, no discount
							</CardContent>
						</Card>

						<Card className="border-green-200 dark:border-green-900">
							<CardHeader>
								<CardDescription>LLM Gateway</CardDescription>
								<CardTitle className="text-2xl text-green-600 dark:text-green-400">
									{formatCurrency(gatewayTotal)}
									<span className="text-sm font-normal text-muted-foreground">
										/mo
									</span>
								</CardTitle>
							</CardHeader>
							<CardContent className="text-sm text-muted-foreground">
								{discount}% discount applied
							</CardContent>
						</Card>
					</div>

					<div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 p-6 text-center">
						<p className="text-sm text-muted-foreground mb-1">
							Your estimated monthly savings
						</p>
						<p className="text-3xl font-bold text-green-600 dark:text-green-400">
							{formatCurrency(savings)}
						</p>
						<Badge className="mt-2 bg-green-600 hover:bg-green-600 text-white">
							{discount}% savings
						</Badge>
					</div>
				</div>
			</div>
		</section>
	);
}
