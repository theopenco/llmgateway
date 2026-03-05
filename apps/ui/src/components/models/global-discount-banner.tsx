"use client";

import { Percent } from "lucide-react";
import { useEffect, useState } from "react";

import { Countdown } from "@/components/countdown";

interface DiscountData {
	id: string;
	provider: string | null;
	model: string | null;
	discountPercent: string;
	reason: string | null;
	expiresAt: string | null;
	createdAt: string;
}

interface GlobalDiscountBannerProps {
	modelId: string;
	apiUrl: string;
}

export function GlobalDiscountBanner({
	modelId,
	apiUrl,
}: GlobalDiscountBannerProps) {
	const [discount, setDiscount] = useState<DiscountData | null>(null);

	useEffect(() => {
		async function fetchDiscounts() {
			try {
				const res = await fetch(
					`${apiUrl}/public/discounts/model/${encodeURIComponent(modelId)}`,
				);
				if (!res.ok) {
					return;
				}
				const data = (await res.json()) as { discounts: DiscountData[] };
				const withExpiry = data.discounts.find(
					(d) => d.expiresAt && new Date(d.expiresAt) > new Date(),
				);
				if (withExpiry) {
					setDiscount(withExpiry);
				}
			} catch {
				// Silently fail — banner is non-critical
			}
		}
		void fetchDiscounts();
	}, [modelId, apiUrl]);

	if (!discount || !discount.expiresAt) {
		return null;
	}

	const percent = (parseFloat(discount.discountPercent) * 100).toFixed(0);

	return (
		<div className="rounded-lg bg-gradient-to-r from-green-500/10 via-emerald-500/10 to-teal-500/10 border border-green-500/20 p-4 flex items-center gap-3 flex-wrap">
			<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500/20">
				<Percent className="h-4 w-4 text-green-600 dark:text-green-400" />
			</div>
			<div className="flex items-center gap-2 flex-wrap">
				<span className="font-semibold text-green-700 dark:text-green-300">
					{percent}% off
				</span>
				<span className="text-sm text-muted-foreground">
					{discount.model ? "this model" : "all models"}
					{discount.provider ? ` via ${discount.provider}` : ""} —
				</span>
				<Countdown expiresAt={discount.expiresAt} />
			</div>
		</div>
	);
}
