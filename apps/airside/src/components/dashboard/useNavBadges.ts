"use client";

import { useMemo } from "react";

import { useAirsideNotifications } from "@/components/dashboard/CarrierProfileReminder";

import type { NavBadges } from "@/components/dashboard/nav";

/**
 * Counts shown next to sidebar items, keyed by nav href
 * (e.g. `{ "/dashboard/brand": 2 }`). Zero/undefined hides the badge.
 */
export function useNavBadges(): NavBadges {
	const { brandCount } = useAirsideNotifications();
	return useMemo(() => ({ "/dashboard/brand": brandCount }), [brandCount]);
}
