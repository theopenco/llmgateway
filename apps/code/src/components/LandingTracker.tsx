"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useAppConfig } from "@/lib/config";

export function LandingPageTracker() {
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();

	useEffect(() => {
		if (!posthogKey) {
			return;
		}
		posthog.capture("page_viewed_code_landing");
	}, [posthog, posthogKey]);

	return null;
}

export function CodeCTATracker({
	children,
	cta,
	location,
}: {
	children: React.ReactNode;
	cta: string;
	location: string;
}) {
	const posthog = usePostHog();

	return (
		<span
			onClick={() =>
				posthog.capture("cta_clicked", {
					app: "code",
					cta,
					location,
				})
			}
		>
			{children}
		</span>
	);
}

export function CodePlanTracker({
	children,
	plan,
	price,
}: {
	children: React.ReactNode;
	plan: string;
	price: number;
}) {
	const posthog = usePostHog();

	return (
		<span
			onClick={() =>
				posthog.capture("pricing_plan_clicked", {
					app: "code",
					plan,
					price,
				})
			}
		>
			{children}
		</span>
	);
}
