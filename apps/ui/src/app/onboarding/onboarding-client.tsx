"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { useUser } from "@/hooks/useUser";

export function OnboardingClient() {
	const router = useRouter();
	const { user } = useUser();

	useEffect(() => {
		if (!user) {
			router.push("/login");
		}
	}, [user, router]);

	if (!user) {
		return null;
	}

	return <OnboardingWizard />;
}
