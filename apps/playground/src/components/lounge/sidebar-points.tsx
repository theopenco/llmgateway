"use client";

import { Flame, Trophy } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";

import { useLoungePoints } from "@/hooks/useLoungePoints";
import { useUser } from "@/hooks/useUser";

// Compact points pill for sidebar footers; links to the member profile.
export function SidebarLoungePoints() {
	const { user } = useUser();
	const { data } = useLoungePoints();
	const reduceMotion = useReducedMotion();

	if (!user || !data) {
		return null;
	}

	const { stats } = data;

	// Deliberately NOT the gold membership treatment: the Chat plan card in
	// CreditsDisplay owns that look in the same footer, and the two were
	// getting mistaken for each other.
	return (
		<Link
			href="/profile"
			className="mx-2 mb-1 flex items-center gap-2 rounded-md bg-sidebar-accent/60 px-3 py-2 text-xs text-sidebar-foreground transition-colors hover:bg-sidebar-accent group-data-[collapsible=icon]:hidden"
		>
			<Trophy className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
			{/* Points earned after a message roll in like an odometer so the
			    reward is visible without pulsing or floating badges. */}
			<span className="relative inline-flex overflow-hidden font-semibold tabular-nums">
				<AnimatePresence mode="popLayout" initial={false}>
					<motion.span
						key={stats.totalPoints}
						initial={
							reduceMotion
								? { opacity: 0 }
								: { opacity: 0, transform: "translateY(100%)" }
						}
						animate={{ opacity: 1, transform: "translateY(0%)" }}
						exit={
							reduceMotion
								? { opacity: 0 }
								: { opacity: 0, transform: "translateY(-100%)" }
						}
						transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
					>
						{stats.totalPoints.toLocaleString()}
					</motion.span>
				</AnimatePresence>
			</span>
			<span className="text-muted-foreground">points · Lv {stats.level}</span>
			<AnimatePresence initial={false}>
				{stats.currentStreak > 1 ? (
					<motion.span
						key="streak"
						initial={
							reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.45 }
						}
						animate={{ opacity: 1, scale: 1 }}
						exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.45 }}
						transition={{ duration: 0.16, ease: "easeOut" }}
						className="ml-auto inline-flex items-center gap-0.5 text-muted-foreground"
					>
						<Flame className="h-3.5 w-3.5 text-orange-500" />
						{stats.currentStreak}
					</motion.span>
				) : null}
			</AnimatePresence>
		</Link>
	);
}
