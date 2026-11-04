"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { useToast } from "@/lib/components/use-toast";
import { invalidateProPlanQueries } from "@/lib/pro-plan-cache";

interface PlanStatusHandlerProps {
	checkoutStatus?: string;
}

// Handles the redirect back from Stripe Checkout after a Pro subscription
// purchase: a toast for the outcome, plus a cache refresh so the plan card
// reflects the new subscription as soon as the webhook has landed.
export function PlanStatusHandler({ checkoutStatus }: PlanStatusHandlerProps) {
	const { toast } = useToast();

	const queryClient = useQueryClient();
	const handled = useRef(false);

	useEffect(() => {
		if (handled.current || !checkoutStatus) {
			return;
		}
		handled.current = true;

		if (checkoutStatus === "success") {
			toast({
				title: "Subscription activated",
				description:
					"Welcome to Pro! It may take a few seconds for your new limits to show up.",
			});
			void invalidateProPlanQueries(queryClient);
		} else if (checkoutStatus === "canceled") {
			toast({
				title: "Checkout canceled",
				description: "Your plan was not changed.",
				variant: "destructive",
			});
		}
	}, [checkoutStatus, toast, queryClient]);

	return null;
}
