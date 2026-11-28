import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { fetchServerData } from "@/lib/server-api";

import SurveyClient from "./SurveyClient";

import type { SurveyEligibility } from "./SurveyClient";

export const metadata = {
	title: "DevPass Model Census — rate your models, earn a Reset Pass",
};

export default async function SurveyPage() {
	const userDataPromise = fetchServerData<{ user: { id: string } } | null>(
		"GET",
		"/user/me",
	);
	const eligibilityPromise = fetchServerData<SurveyEligibility>(
		"GET",
		"/model-survey/eligibility",
	);

	const userData = await userDataPromise;

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard/survey");
	}

	const eligibility = await eligibilityPromise;

	if (!eligibility || eligibility.topModels.length === 0) {
		const year = eligibility?.year ?? new Date().getUTCFullYear();
		return (
			<div className="min-h-screen bg-background py-12">
				<div className="mx-auto max-w-2xl px-4">
					<div className="space-y-3 rounded-xl border border-dashed p-6">
						<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
							DevPass Model Census · {year}
						</div>
						<h1 className="text-xl font-semibold">Nothing to declare — yet</h1>
						<p className="text-sm text-muted-foreground">
							The census asks about models you genuinely use: at least{" "}
							{eligibility?.minimumRequests ?? 50} requests on a model in the
							last {eligibility?.windowDays ?? 30} days qualifies it. Keep
							shipping and check back — your first entry of each quarterly wave
							earns a free Reset Pass.
						</p>
						<Button asChild variant="outline">
							<Link href="/dashboard">Back to dashboard</Link>
						</Button>
					</div>
				</div>
			</div>
		);
	}

	if (eligibility.topModels.every((model) => model.alreadySubmitted)) {
		return (
			<div className="min-h-screen bg-background py-12">
				<div className="mx-auto max-w-2xl px-4">
					<div className="space-y-3 rounded-xl border border-dashed p-6">
						<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
							DevPass Model Census · {eligibility.year}
						</div>
						<h1 className="text-xl font-semibold">
							All filed for Q{eligibility.quarter} {eligibility.year}
						</h1>
						<p className="text-sm text-muted-foreground">
							You have rated every model that qualifies this wave. Check back
							next quarter, or see how the registry is shaping up.
						</p>
						<div className="flex flex-wrap gap-2">
							<Button asChild>
								<Link href={`/data/${eligibility.year}`}>View the census</Link>
							</Button>
							<Button asChild variant="outline">
								<Link href="/dashboard">Back to dashboard</Link>
							</Button>
						</div>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="min-h-screen bg-background py-12">
			<div className="mx-auto max-w-2xl px-4">
				<SurveyClient initialEligibility={eligibility} />
			</div>
		</div>
	);
}
