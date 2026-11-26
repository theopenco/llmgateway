"use client";

import { Stamp } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

// Split out of DashboardShell so motion stays out of the shell bundle every
// dashboard route loads; this renders only right after a checkout succeeds.
export default function ActivationStamp() {
	const reduceMotion = useReducedMotion();
	return (
		<motion.div
			initial={
				reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 2.4, rotate: -18 }
			}
			animate={
				reduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: -8 }
			}
			transition={{ type: "spring", duration: 0.4 }}
			className="mx-auto mb-6 flex justify-center"
		>
			<div className="rounded-md border-4 border-double border-emerald-700/80 px-6 py-3 text-center font-mono uppercase text-emerald-800 mix-blend-multiply dark:border-emerald-400/80 dark:text-emerald-300 dark:mix-blend-screen">
				<div className="flex items-center justify-center gap-2 text-base font-bold tracking-[0.3em]">
					<Stamp className="h-4 w-4" />
					DevPass activated
				</div>
				<div className="mt-0.5 text-[9px] tracking-[0.2em]">
					Visa granted · welcome aboard
				</div>
			</div>
		</motion.div>
	);
}
