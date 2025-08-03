import { CreditCard, Key, Lock, ArrowRight } from "lucide-react";
import * as React from "react";

import { UpgradeToProDialog } from "@/components/shared/upgrade-to-pro-dialog";
import { useDefaultOrganization } from "@/hooks/useOrganization";
import { Button } from "@/lib/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { Step } from "@/lib/components/stepper";
import { useAppConfig } from "@/lib/config";

interface PlanChoiceStepProps {
	onSelectCredits: () => void;
	onSelectBYOK: () => void;
	hasSelectedPlan?: boolean;
}

export function PlanChoiceStep({
	onSelectCredits,
	onSelectBYOK,
}: PlanChoiceStepProps) {
	const config = useAppConfig();
	const { data: organization } = useDefaultOrganization();
	const isProPlan = organization?.plan === "pro";

	return (
		<Step>
			<div className="flex flex-col gap-6">
				<div className="flex flex-col gap-2 text-center">
					<h1 className="text-2xl font-bold">Choose Your Approach</h1>
					<p className="text-muted-foreground">
						Select how you&apos;d like to use LLM Gateway, or skip to continue
						with the free plan
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
					{/* Credits Option */}
					<Card className="flex flex-col">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<CreditCard className="h-5 w-5" />
								Buy Credits
							</CardTitle>
							<CardDescription>
								Use our managed service with pay-as-you-go credits
							</CardDescription>
						</CardHeader>
						<CardContent className="flex-1 flex flex-col justify-between">
							<div className="space-y-3">
								<ul className="space-y-2 text-sm">
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-green-500 rounded-full" />
										Simple pay-as-you-go pricing
									</li>
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-green-500 rounded-full" />
										No API key management needed
									</li>
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-green-500 rounded-full" />
										Built-in rate limiting and monitoring
									</li>
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-green-500 rounded-full" />
										Works with any plan
									</li>
								</ul>
							</div>
							<Button
								className="w-full mt-4"
								onClick={onSelectCredits}
								disabled={!config.hosted}
							>
								{config.hosted ? (
									<>
										Choose Credits
										<ArrowRight className="ml-2 h-4 w-4" />
									</>
								) : (
									"Only available on llmgateway.io"
								)}
							</Button>
						</CardContent>
					</Card>

					{/* BYOK Option */}
					<Card className="flex flex-col">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Key className="h-5 w-5" />
								Bring Your Own Keys
								{!isProPlan && (
									<span className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded">
										Pro Plan Required
									</span>
								)}
							</CardTitle>
							<CardDescription>
								Use your own API keys for LLM providers
							</CardDescription>
						</CardHeader>
						<CardContent className="flex-1 flex flex-col justify-between">
							<div className="space-y-3">
								<ul className="space-y-2 text-sm">
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-blue-500 rounded-full" />
										Full control over provider costs
									</li>
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-blue-500 rounded-full" />
										Direct billing from providers
									</li>
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-blue-500 rounded-full" />
										Custom rate limits and quotas
									</li>
									<li className="flex items-center gap-2">
										<div className="h-1.5 w-1.5 bg-blue-500 rounded-full" />
										Advanced enterprise features
									</li>
								</ul>

								{!isProPlan && (
									<div className="rounded-md bg-blue-50 dark:bg-blue-950 p-3 text-sm">
										<p className="font-medium text-blue-800 dark:text-blue-300 mb-1">
											Pro Plan Required
										</p>
										<p className="text-blue-700 dark:text-blue-400">
											BYOK requires a Pro plan subscription to access advanced
											features and custom provider support.
										</p>
									</div>
								)}
							</div>

							{isProPlan ? (
								<Button
									className="w-full mt-4"
									onClick={onSelectBYOK}
									variant="outline"
								>
									Choose BYOK
									<ArrowRight className="ml-2 h-4 w-4" />
								</Button>
							) : (
								<UpgradeToProDialog>
									<Button className="w-full mt-4" variant="outline">
										<Lock className="mr-2 h-4 w-4" />
										Upgrade to Pro for BYOK
									</Button>
								</UpgradeToProDialog>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</Step>
	);
}
