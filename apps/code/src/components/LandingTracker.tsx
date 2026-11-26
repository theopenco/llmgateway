"use client";

import { usePostHog } from "posthog-js/react";
import { useEffect } from "react";

import { useAppConfig } from "@/lib/config";

function usePageViewed(event: string) {
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();

	useEffect(() => {
		if (!posthogKey) {
			return;
		}
		posthog.capture(event);
	}, [event, posthog, posthogKey]);
}

export function LandingPageTracker() {
	usePageViewed("page_viewed_code_landing");
	return null;
}

export function StartPageTracker() {
	usePageViewed("page_viewed_start");
	return null;
}

export function KoreanPageTracker() {
	usePageViewed("page_viewed_ko");
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
