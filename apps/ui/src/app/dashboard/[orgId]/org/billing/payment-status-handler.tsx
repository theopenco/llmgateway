"use client";

import { useEffect, useRef } from "react";

import { useToast } from "@/lib/components/use-toast";

interface PaymentStatusHandlerProps {
	paymentStatus?: string;
}

export function PaymentStatusHandler({
	paymentStatus,
}: PaymentStatusHandlerProps) {
	const { toast } = useToast();
	const handled = useRef(false);

	useEffect(() => {
		if (handled.current) {
			return;
		}
		if (!paymentStatus) {
			return;
		}

		handled.current = true;

		if (paymentStatus === "success") {
			toast({
				title: "Payment successful",
				description: "Your payment has been processed successfully.",
			});
		} else if (paymentStatus === "canceled") {
			toast({
				title: "Payment canceled",
				description: "Your payment was canceled.",
				variant: "destructive",
			});
		}
	}, [paymentStatus, toast]);

	return null; // This component only handles side effects, no UI
}
