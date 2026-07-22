"use client";

import { Stamp } from "lucide-react";
import { motion } from "motion/react";
import { useRouter } from "next/navigation";
import { usePostHog } from "posthog-js/react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useAppConfig } from "@/lib/config";
import { getCookie, setCookie } from "@/lib/cookies";
import { useApi } from "@/lib/fetch-client";

// "Maybe later" keeps the census quiet for two weeks within the current
// quarterly wave; a submission silences it for the rest of the quarter
// server-side (eligibility flips to false). The cookie is scoped per wave so
// a dismissal never bleeds into the next quarter's census.
const SNOOZE_DAYS = 14;
const snoozeCookie = (year: number, quarter: number) =>
	`devpass_census_snooze_${year}_q${quarter}`;

export default function SurveyReminderDialog({ active }: { active: boolean }) {
	const api = useApi();
	const router = useRouter();
	const posthog = usePostHog();
	const { posthogKey } = useAppConfig();
	const [open, setOpen] = useState(false);
	const shownTracked = useRef(false);

	const { data } = api.useQuery(
		"get",
		"/model-survey/eligibility",
		{},
		{ enabled: active, staleTime: 5 * 60 * 1000 },
	);

	const topModel = data?.topModels.find((m) => !m.alreadySubmitted);

	useEffect(() => {
		if (!data?.eligible || !data.rewardAvailable || !topModel) {
			return;
		}
		if (getCookie(snoozeCookie(data.year, data.quarter))) {
			return;
		}
		const timer = setTimeout(() => {
			setOpen(true);
			if (!shownTracked.current && posthogKey) {
				shownTracked.current = true;
				posthog.capture("model_survey_prompt_shown", {
					year: data.year,
					quarter: data.quarter,
					model: topModel.modelId,
					request_count: topModel.requestCount,
				});
			}
		}, 900);
		return () => clearTimeout(timer);
	}, [data, topModel, posthog, posthogKey]);

	if (!data || !topModel) {
		return null;
	}

	const dismiss = () => {
		setOpen(false);
		setCookie(snoozeCookie(data.year, data.quarter), "1", SNOOZE_DAYS);
		if (posthogKey) {
			posthog.capture("model_survey_prompt_dismissed", {
				year: data.year,
				quarter: data.quarter,
				model: topModel.modelId,
			});
		}
	};

	const accept = () => {
		if (posthogKey) {
			posthog.capture("model_survey_prompt_accepted", {
				year: data.year,
				quarter: data.quarter,
				model: topModel.modelId,
			});
		}
		setOpen(false);
		router.push(
			`/dashboard/survey?model=${encodeURIComponent(topModel.modelId)}`,
		);
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					dismiss();
				}
			}}
		>
			<DialogContent
				data-testid="census-dialog"
				className="overflow-hidden border-dashed border-stone-400/70 dark:border-stone-600/70"
			>
				{/* Inked census stamp, slammed into the corner on open */}
				<motion.div
					initial={{ opacity: 0, scale: 2, rotate: -20 }}
					animate={{ opacity: 1, scale: 1, rotate: 8 }}
					transition={{ type: "spring", duration: 0.5, delay: 0.15 }}
					className="pointer-events-none absolute -right-5 -top-5 flex h-24 w-24 flex-col items-center justify-center rounded-full border-[3px] border-double border-emerald-700/70 text-center font-mono uppercase text-emerald-800 mix-blend-multiply dark:border-emerald-400/60 dark:text-emerald-300 dark:mix-blend-screen"
				>
					<span className="text-[8px] leading-none tracking-[0.2em]">
						Census
					</span>
					<Stamp className="my-1 h-4 w-4" />
					<span className="text-[8px] leading-none tracking-[0.2em]">
						Q{data.quarter} {data.year}
					</span>
				</motion.div>

				<DialogHeader>
					<div className="font-mono text-[10px] uppercase tracking-[0.35em] text-stone-500 dark:text-stone-400">
						DevPass Model Census · Q{data.quarter} {data.year}
					</div>
					<DialogTitle className="pr-16 text-balance">
						You and {topModel.modelId} have been logging serious miles
					</DialogTitle>
					<DialogDescription className="pr-10">
						{topModel.requestCount.toLocaleString()} requests in the last{" "}
						{data.windowDays} days. Got a minute to rate it for the Q
						{data.quarter} census wave? A free Reset Pass is stamped into your
						passport the moment you do — every quarter you take part.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter className="gap-2 sm:gap-0">
					<Button
						variant="ghost"
						onClick={dismiss}
						data-testid="census-dialog-dismiss"
					>
						Maybe later
					</Button>
					<Button onClick={accept} data-testid="census-dialog-cta">
						<Stamp className="mr-1.5 h-4 w-4" />
						Rate it · claim your pass
					</Button>
				</DialogFooter>

				{/* Machine-readable zone, purely decorative */}
				<div
					aria-hidden="true"
					className="-mx-6 -mb-6 mt-2 select-none overflow-hidden whitespace-nowrap border-t border-dashed border-stone-300/80 px-6 pb-1.5 pt-1 font-mono text-[9px] tracking-[0.3em] text-stone-400/80 dark:border-stone-700/80 dark:text-stone-600"
				>
					CS{`<`}LLMGATEWAY{`<<`}CENSUS{`<`}
					{data.year}
					{`<<`}RESET{`<`}PASS{`<`.repeat(24)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
