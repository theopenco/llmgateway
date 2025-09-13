"use client";
import { Elements } from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import * as React from "react";
import { useState } from "react";

import { Card, CardContent } from "@/lib/components/card";
import { Stepper } from "@/lib/components/stepper";
import { useApi } from "@/lib/fetch-client";
import { useStripe } from "@/lib/stripe";

import { ApiKeyStep } from "./api-key-step";
import { CreditsStep } from "./credits-step";
import { PlanChoiceStep } from "./plan-choice-step";
import { ProviderKeyStep } from "./provider-key-step";
import { ReferralStep } from "./referral-step";
import { WelcomeStep } from "./welcome-step";

type FlowType = "credits" | "byok" | null;

const getSteps = (flowType: FlowType) => [
	{
		id: "welcome",
		title: "Welcome",
	},
	{
		id: "referral",
		title: "How did you hear about us?",
		optional: true,
	},
	{
		id: "api-key",
		title: "API Key",
	},
	{
		id: "plan-choice",
		title: "Choose Plan",
	},
	{
		id: flowType === "credits" ? "credits" : "provider-key",
		title: flowType === "credits" ? "Credits" : "Provider Key",
		optional: true,
	},
];

export function OnboardingWizard() {
	const [activeStep, setActiveStep] = useState(0);
	const [flowType, setFlowType] = useState<FlowType>(null);
	const [hasSelectedPlan, setHasSelectedPlan] = useState(false);
	const [isPaymentSuccessful, setIsPaymentSuccessful] = useState(false);
	const [referralSource, setReferralSource] = useState<string>("");
	const [referralDetails, setReferralDetails] = useState<string>("");
	const router = useRouter();
	const posthog = usePostHog();
	const { stripe, isLoading: stripeLoading } = useStripe();
	const queryClient = useQueryClient();
	const api = useApi();
	const completeOnboarding = api.useMutation(
		"post",
		"/user/me/complete-onboarding",
	);

	const STEPS = getSteps(flowType);

	const handleStepChange = async (step: number) => {
		// Special handling for plan choice step (now at index 3)
		if (activeStep === 3) {
			if (!hasSelectedPlan) {
				// Skip to dashboard if no plan selected
				posthog.capture("onboarding_skipped", {
					skippedAt: "plan_choice",
					referralSource: referralSource || "not_provided",
					referralDetails: referralDetails || undefined,
				});
				await completeOnboarding.mutateAsync({});
				const queryKey = api.queryOptions("get", "/user/me").queryKey;
				await queryClient.invalidateQueries({ queryKey });
				router.push("/dashboard");
				return;
			}
			// If plan is selected, continue to next step
		}

		if (step >= STEPS.length) {
			posthog.capture("onboarding_completed", {
				completedSteps: STEPS.map((step) => step.id),
				flowType,
				referralSource: referralSource || "not_provided",
				referralDetails: referralDetails || undefined,
			});

			await completeOnboarding.mutateAsync({});
			const queryKey = api.queryOptions("get", "/user/me").queryKey;
			await queryClient.invalidateQueries({ queryKey });
			router.push("/dashboard");
			return;
		}
		setActiveStep(step);
	};

	const handleSelectCredits = () => {
		setFlowType("credits");
		setHasSelectedPlan(true);
		setActiveStep(4);
	};

	const handleSelectBYOK = () => {
		setFlowType("byok");
		setHasSelectedPlan(true);
		setActiveStep(4);
	};

	const handleReferralComplete = (source: string, details?: string) => {
		setReferralSource(source);
		if (details) {
			setReferralDetails(details);
		}
		setActiveStep(2); // Move to API Key step
	};

	// Special handling for PlanChoiceStep to pass callbacks
	const renderCurrentStep = () => {
		if (activeStep === 3) {
			return (
				<PlanChoiceStep
					onSelectCredits={handleSelectCredits}
					onSelectBYOK={handleSelectBYOK}
					hasSelectedPlan={hasSelectedPlan}
				/>
			);
		}

		// For credits step, wrap with Stripe Elements
		if (activeStep === 4 && flowType === "credits") {
			return stripeLoading ? (
				<div className="p-6 text-center">Loading payment form...</div>
			) : (
				<Elements stripe={stripe}>
					<CreditsStep onPaymentSuccess={() => setIsPaymentSuccessful(true)} />
				</Elements>
			);
		}

		// For BYOK step
		if (activeStep === 4 && flowType === "byok") {
			return <ProviderKeyStep />;
		}

		// For other steps
		if (activeStep === 0) {
			return <WelcomeStep />;
		}

		if (activeStep === 1) {
			return <ReferralStep onComplete={handleReferralComplete} />;
		}

		if (activeStep === 2) {
			return <ApiKeyStep />;
		}

		return null;
	};

	// Customize stepper steps to show appropriate button text
	const getStepperSteps = () => {
		return STEPS.map((step, index) => ({
			...step,
			// Make plan choice step show Skip when no selection
			...(index === 3 &&
				!hasSelectedPlan && {
					customNextText: "Skip",
				}),
			// Remove optional status from credits step when payment is successful
			...(index === 4 &&
				flowType === "credits" &&
				isPaymentSuccessful && {
					optional: false,
				}),
		}));
	};

	return (
		<div className="container mx-auto max-w-3xl py-10">
			<Card>
				<CardContent className="p-6 sm:p-8">
					<Stepper
						steps={getStepperSteps()}
						activeStep={activeStep}
						onStepChange={handleStepChange}
						className="mb-6"
						nextButtonDisabled={
							activeStep === 4 && flowType === "credits" && !isPaymentSuccessful
						}
					>
						{renderCurrentStep()}
					</Stepper>
				</CardContent>
			</Card>
		</div>
	);
}
