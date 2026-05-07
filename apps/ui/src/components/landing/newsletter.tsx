"use client";

import { CheckCircle2, Mail, Sparkles, Zap } from "lucide-react";
import { useState } from "react";

import { motion, type Variants } from "@/components/motion-wrapper";
import { Input } from "@/lib/components/input";
import { ShimmerButton } from "@/lib/components/shimmer-button";
import { useApi } from "@/lib/fetch-client";
import { cn } from "@/lib/utils";

const containerVariants: Variants = {
	hidden: { opacity: 0 },
	visible: {
		opacity: 1,
		transition: {
			staggerChildren: 0.12,
			delayChildren: 0.1,
		},
	},
};

const itemVariants: Variants = {
	hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
	visible: {
		opacity: 1,
		y: 0,
		filter: "blur(0px)",
		transition: { duration: 0.5, ease: [0.25, 0.4, 0.25, 1] },
	},
};

const perks = [
	{
		icon: Zap,
		label: "New models & providers as they drop",
	},
	{
		icon: Sparkles,
		label: "Tips to cut latency & costs",
	},
	{
		icon: Mail,
		label: "Early access to beta features",
	},
];

export default function Newsletter() {
	const [email, setEmail] = useState("");
	const api = useApi();

	const subscribe = api.useMutation("post", "/public/newsletter/subscribe");

	return (
		<motion.section
			initial="hidden"
			whileInView="visible"
			viewport={{ once: true, amount: 0.2 }}
			variants={containerVariants}
			className="relative pb-16"
		>
			{/* Card */}
			<div className="relative rounded-2xl border border-border/60 bg-gradient-to-b from-muted/40 to-muted/20 overflow-hidden">
				{/* Ambient glow */}
				<div className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 h-48 w-[70%] rounded-full bg-blue-500/[0.07] dark:bg-blue-400/[0.05] blur-3xl" />

				{/* Noise texture */}
				<div className="pointer-events-none absolute inset-0 bg-noise opacity-[0.03]" />

				{/* Gradient top border accent */}
				<div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500/40 to-transparent" />

				<div className="relative px-6 py-12 sm:px-10 sm:py-14 md:px-14 md:py-16">
					{subscribe.isSuccess ? (
						<motion.div
							initial={{ opacity: 0, scale: 0.95 }}
							animate={{ opacity: 1, scale: 1 }}
							transition={{
								type: "spring",
								stiffness: 300,
								damping: 24,
							}}
							className="flex flex-col items-center gap-5 text-center py-4"
						>
							<div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 ring-1 ring-green-500/20">
								<CheckCircle2 className="h-7 w-7 text-green-500" />
							</div>
							<div className="space-y-2">
								<h3 className="font-display text-2xl font-bold tracking-tight text-foreground">
									You&apos;re in!
								</h3>
								<p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
									{subscribe.data?.message ??
										"Check your inbox — we'll send you the good stuff, no filler."}
								</p>
							</div>
						</motion.div>
					) : (
						<div className="flex flex-col md:flex-row md:items-center md:justify-between gap-10 md:gap-16">
							{/* Left — copy & perks */}
							<div className="flex-1 max-w-lg space-y-6">
								<motion.div variants={itemVariants} className="space-y-3">
									<p className="text-xs font-semibold uppercase tracking-widest text-blue-600 dark:text-blue-400">
										Newsletter
									</p>
									<h3 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-foreground leading-tight">
										Stay ahead of the curve
									</h3>
									<p className="text-muted-foreground text-sm leading-relaxed max-w-md">
										Join developers who get weekly insights on LLM routing, new
										model launches, and cost optimization — straight to their
										inbox.
									</p>
								</motion.div>

								<motion.ul
									variants={itemVariants}
									className="flex flex-col gap-3"
								>
									{perks.map((perk) => (
										<li
											key={perk.label}
											className="flex items-center gap-3 text-sm text-muted-foreground"
										>
											<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05] ring-1 ring-border">
												<perk.icon className="h-3.5 w-3.5 text-foreground/70" />
											</span>
											{perk.label}
										</li>
									))}
								</motion.ul>
							</div>

							{/* Right — form */}
							<motion.div
								variants={itemVariants}
								className="w-full md:w-auto md:min-w-[340px]"
							>
								<form
									className="flex flex-col gap-3"
									onSubmit={(e) => {
										e.preventDefault();
										if (subscribe.isPending) {
											return;
										}
										subscribe.mutate({
											body: { email },
										});
									}}
								>
									<Input
										type="email"
										placeholder="you@company.com"
										value={email}
										onChange={(e) => setEmail(e.target.value)}
										required
										className={cn(
											"h-12 rounded-xl bg-background/80 backdrop-blur-sm",
											"border-border/80 text-base px-4",
											"focus-visible:border-blue-500/50 focus-visible:ring-blue-500/20",
										)}
									/>
									<ShimmerButton
										type="submit"
										disabled={subscribe.isPending}
										background="rgb(37, 99, 235)"
										borderRadius="12px"
										className="w-full h-12 text-sm font-semibold shadow-lg shadow-blue-500/20"
									>
										{subscribe.isPending
											? "Subscribing..."
											: "Subscribe — it's free"}
									</ShimmerButton>
									<p className="text-[11px] text-muted-foreground/60 text-center">
										No spam. Unsubscribe anytime.
									</p>
								</form>

								{subscribe.isError && (
									<motion.p
										initial={{ opacity: 0, y: -4 }}
										animate={{ opacity: 1, y: 0 }}
										className="mt-3 text-sm text-destructive text-center"
									>
										{(
											subscribe.error as {
												message?: string;
											}
										)?.message ?? "Something went wrong. Please try again."}
									</motion.p>
								)}
							</motion.div>
						</div>
					)}
				</div>
			</div>
		</motion.section>
	);
}
