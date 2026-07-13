import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { fetchServerData } from "@/lib/server-api";

import FeedbackForm, {
	type ExistingFeedback,
	type PreviousDevPlan,
} from "./FeedbackForm";

interface EligibilityResponse {
	eligible: boolean;
	subscriptionId: string | null;
	previousDevPlan: PreviousDevPlan;
	existingFeedback: ExistingFeedback | null;
}

export default async function DevPlanCancellationFeedbackPage() {
	const userData = await fetchServerData<{ user: { id: string } } | null>(
		"GET",
		"/user/me",
	);

	if (!userData?.user) {
		redirect("/login?returnUrl=/dashboard/feedback/dev-plan-cancellation");
	}

	const eligibility = await fetchServerData<EligibilityResponse>(
		"GET",
		"/dev-plan-cancellation-feedback/eligibility",
	);

	return (
		<div className="min-h-screen bg-background py-12">
			<div className="mx-auto max-w-2xl px-4">
				{eligibility?.eligible ? (
					<FeedbackForm
						existingFeedback={eligibility.existingFeedback}
						previousDevPlan={eligibility.previousDevPlan}
					/>
				) : (
					<div className="rounded-xl border p-6 space-y-3">
						<h1 className="text-xl font-semibold">
							No feedback to share right now
						</h1>
						<p className="text-sm text-muted-foreground">
							This page is for sharing feedback after cancelling a Dev Plan. We
							don't see a recent cancellation on your account.
						</p>
						<Button asChild variant="outline">
							<Link href="/dashboard">Back to dashboard</Link>
						</Button>
					</div>
				)}
			</div>
		</div>
	);
}
