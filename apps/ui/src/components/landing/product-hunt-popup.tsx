"use client";

import { ArrowUp, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";

const STORAGE_KEY = "ph_chat_popup_dismissed";
const PH_URL =
	"https://www.producthunt.com/products/llm-gateway?launch=llm-gateway-chat";

const BARS = [
	"from-green-400 to-emerald-500 shadow-emerald-500/40",
	"from-pink-400 to-rose-500 shadow-rose-500/40",
	"from-blue-400 to-blue-600 shadow-blue-500/40",
	"from-amber-300 to-orange-500 shadow-orange-500/40",
	"from-violet-400 to-purple-600 shadow-purple-500/40",
	"from-teal-300 to-cyan-500 shadow-cyan-500/40",
];

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
					LLM Gateway Chat is live today — 210+ models across chat, image,
					video, audio & group. Your upvote means the world.
				</p>

				<div className="mt-6 flex items-center gap-2">
					{BARS.map((bar) => (
						<span
							key={bar}
							className={`h-1.5 flex-1 rounded-full bg-gradient-to-r shadow-[0_0_12px] ${bar}`}
						/>
					))}
				</div>

				<a
					href={PH_URL}
					target="_blank"
					rel="noopener noreferrer"
					onClick={dismiss}
					className="mt-7 flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100"
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
