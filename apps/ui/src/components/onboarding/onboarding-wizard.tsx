import { Elements } from "@stripe/react-stripe-js";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import * as React from "react";
import { useState } from "react";

import { ApiKeyStep } from "./api-key-step";
import { CreditsStep } from "./credits-step";
import { PlanChoiceStep } from "./plan-choice-step";
import { ProviderKeyStep } from "./provider-key-step";
import { WelcomeStep } from "./welcome-step";
import { Card, CardContent } from "@/lib/components/card";
import { Stepper } from "@/lib/components/stepper";
import { useApi } from "@/lib/fetch-client";
import { useStripe } from "@/lib/stripe";

type FlowType = "credits" | "byok" | null;

const getSteps = (flowType: FlowType) => [
	{
		id: "welcome",
		title: "Welcome",
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
	const navigate = useNavigate();
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
		// Special handling for plan choice step
		if (activeStep === 2) {
			if (!hasSelectedPlan) {
				// Skip to dashboard if no plan selected
				posthog.capture("onboarding_skipped", {
					skippedAt: "plan_choice",
				});
				await completeOnboarding.mutateAsync({});
				queryClient.clear();
				navigate({ to: "/dashboard" });
				return;
			}
			// If plan is selected, continue to next step
		}

		if (step >= STEPS.length) {
			posthog.capture("onboarding_completed", {
				completedSteps: STEPS.map((step) => step.id),
				flowType,
			});

			await completeOnboarding.mutateAsync({});
			queryClient.clear();
			navigate({ to: "/dashboard" });
			return;
		}
		setActiveStep(step);
	};

	const handleSelectCredits = () => {
		setFlowType("credits");
		setHasSelectedPlan(true);
		setActiveStep(3);
	};

	const handleSelectBYOK = () => {
		setFlowType("byok");
		setHasSelectedPlan(true);
		setActiveStep(3);
	};

	// Special handling for PlanChoiceStep to pass callbacks
	const renderCurrentStep = () => {
		if (activeStep === 2) {
			return (
				<PlanChoiceStep
					onSelectCredits={handleSelectCredits}
					onSelectBYOK={handleSelectBYOK}
					hasSelectedPlan={hasSelectedPlan}
				/>
			);
		}

		// For credits step, wrap with Stripe Elements
		if (activeStep === 3 && flowType === "credits") {
			return stripeLoading ? (
				<div className="p-6 text-center">Loading payment form...</div>
			) : (
				<Elements stripe={stripe}>
					<CreditsStep onPaymentSuccess={() => setIsPaymentSuccessful(true)} />
				</Elements>
			);
		}

		// For BYOK step
		if (activeStep === 3 && flowType === "byok") {
			return <ProviderKeyStep />;
		}

		// For other steps
		if (activeStep === 0) {
			return <WelcomeStep />;
		}

		if (activeStep === 1) {
			return <ApiKeyStep />;
		}

		return null;
	};

	// Customize stepper steps to show appropriate button text
	const getStepperSteps = () => {
		return STEPS.map((step, index) => ({
			...step,
			// Make plan choice step show Skip when no selection
			...(index === 2 &&
				!hasSelectedPlan && {
					customNextText: "Skip",
				}),
			// Remove optional status from credits step when payment is successful
			...(index === 3 &&
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
							activeStep === STEPS.length - 1 &&
							flowType === "credits" &&
							!isPaymentSuccessful
						}
					>
						{renderCurrentStep()}
					</Stepper>
				</CardContent>
			</Card>
		</div>
	);
}
