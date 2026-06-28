"use client";

import { AudioLines, Film, ImagePlus, MessageSquare } from "lucide-react";
import { motion } from "motion/react";

export function ChatBrandBadge() {
	return (
		<div className="inline-flex items-center gap-2 rounded-full border border-violet-500/20 bg-violet-500/10 px-3 py-1">
			<div className="h-1.5 w-1.5 rounded-full bg-violet-400" />
			<span className="text-xs font-medium text-violet-400">
				LLM Gateway Chat
			</span>
		</div>
	);
}

export function ChatBrandPanel({
	headline,
	subline,
}: {
	headline: React.ReactNode;
	subline: string;
}) {
	return (
		<div className="relative hidden w-1/2 overflow-hidden bg-zinc-950 lg:flex lg:flex-col lg:justify-between">
			<div
				className="absolute inset-0 opacity-[0.15]"
				style={{
					backgroundImage:
						"radial-gradient(circle, rgba(255,255,255,0.15) 1px, transparent 1px)",
					backgroundSize: "24px 24px",
				}}
			/>
			<div className="absolute left-1/2 top-1/2 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-500/10 blur-[100px]" />

			<div className="relative z-10 flex flex-1 flex-col justify-center px-12 xl:px-16">
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.6, ease: "easeOut" }}
				>
					<ChatBrandBadge />
					<h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-white xl:text-5xl">
						{headline}
					</h1>
					<p className="mt-4 max-w-md text-lg text-zinc-400">{subline}</p>
				</motion.div>

				{/* Chat mockup */}
				<motion.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
					className="mt-10 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/80"
				>
					<div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-2.5">
						<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
						<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
						<div className="h-2.5 w-2.5 rounded-full bg-zinc-700" />
						<span className="ml-2 text-xs text-zinc-600">
							chat.llmgateway.io
						</span>
					</div>
					<div className="space-y-3 p-4 text-sm">
						<div className="flex justify-end">
							<p className="max-w-[75%] rounded-2xl rounded-br-sm bg-violet-500/15 px-3.5 py-2 text-zinc-200">
								Which model should I use for this?
							</p>
						</div>
						<div className="flex justify-start">
							<div className="max-w-[80%] rounded-2xl rounded-bl-sm border border-zinc-800 bg-zinc-900 px-3.5 py-2">
								<p className="text-zinc-300">
									Auto-routing picked the best one for the job. Want me to
									compare a few side by side?
								</p>
							</div>
						</div>
						<div className="flex flex-wrap items-center gap-1.5 pt-1">
							{["GPT", "Claude", "Gemini", "+ hundreds more"].map((chip) => (
								<span
									key={chip}
									className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-0.5 text-xs text-zinc-500"
								>
									{chip}
								</span>
							))}
						</div>
					</div>
				</motion.div>

				<motion.div
					initial={{ opacity: 0 }}
					animate={{ opacity: 1 }}
					transition={{ duration: 0.6, delay: 0.4 }}
					className="mt-8 flex items-center gap-6"
				>
					<div className="flex items-center gap-2 text-zinc-500">
						<MessageSquare className="h-4 w-4" />
						<span className="text-xs">Chat</span>
					</div>
					<div className="flex items-center gap-2 text-zinc-500">
						<ImagePlus className="h-4 w-4" />
						<span className="text-xs">Image Studio</span>
					</div>
					<div className="flex items-center gap-2 text-zinc-500">
						<Film className="h-4 w-4" />
						<span className="text-xs">Video Studio</span>
					</div>
					<div className="flex items-center gap-2 text-zinc-500">
						<AudioLines className="h-4 w-4" />
						<span className="text-xs">Audio Studio</span>
					</div>
				</motion.div>
			</div>
		</div>
	);
}
