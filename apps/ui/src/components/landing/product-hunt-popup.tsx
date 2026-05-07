"use client";

import { ArrowUp, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

const STORAGE_KEY = "ph_devpass_popup_dismissed";
const PH_URL = "https://www.producthunt.com/products/devpass-by-llm-gateway";

export function ProductHuntPopup() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (
			typeof window === "undefined" ||
			localStorage.getItem(STORAGE_KEY) === "true"
		) {
			return;
		}
		const t = setTimeout(() => setOpen(true), 1500);
		return () => clearTimeout(t);
	}, []);

	const dismiss = () => {
		localStorage.setItem(STORAGE_KEY, "true");
		setOpen(false);
	};

	if (!open) {
		return null;
	}

	return (
		<div className="fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-[420px] animate-in fade-in slide-in-from-bottom-4 duration-500">
			<div className="relative overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
				<div className="flex items-start justify-between">
					<div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-orange-500 to-red-500 py-1 pl-1 pr-3">
						<span className="flex size-5 items-center justify-center rounded-full bg-white text-[11px] font-bold text-orange-500">
							P
						</span>
						<span className="text-xs font-semibold text-white">Live now</span>
					</div>
					<button
						onClick={dismiss}
						aria-label="Dismiss"
						className="text-zinc-500 transition-colors hover:text-zinc-300"
					>
						<X className="size-5" />
					</button>
				</div>

				<div className="mt-6">
					<Image
						src="/brand/logo-white.svg"
						alt="LLM Gateway"
						width={36}
						height={36}
						className="opacity-90"
					/>
				</div>

				<h3 className="mt-4 text-3xl font-bold leading-tight text-white">
					We're on
					<br />
					Product Hunt!
				</h3>

				<p className="mt-4 text-sm leading-relaxed text-zinc-400">
					DevPass is live today. Your upvote helps every dev get $3 in model
					usage for $1 paid.
				</p>

				<div className="mt-5 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 font-mono text-sm">
					<span className="text-zinc-300">$1 in → $3 out</span>
					<span className="text-emerald-400">~6× w/ SoulForge</span>
				</div>

				<a
					href={PH_URL}
					target="_blank"
					rel="noopener noreferrer"
					onClick={dismiss}
					className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100"
				>
					<ArrowUp className="size-4" />
					Upvote on Product Hunt
				</a>

				<button
					onClick={dismiss}
					className="mt-3 w-full text-center text-sm text-zinc-500 transition-colors hover:text-zinc-300"
				>
					Maybe later
				</button>
			</div>
		</div>
	);
}
