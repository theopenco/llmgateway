"use client";
import { buttonVariants } from "fumadocs-ui/components/ui/button";
import { MessageCircleIcon } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useEffectEvent, useState } from "react";

import { cn } from "@/lib/cn";

// The panel module pulls in @ai-sdk/react, its transport and the remark/shiki
// markdown pipeline. Loading it on demand keeps all of that out of the initial
// bundle of every docs page; the trigger below stays server-rendered so the
// button never pops in after hydration.
const AISearchPanel = dynamic(() => import("./search"), {
	loading: () => null,
});

export function AskAI() {
	const [open, setOpen] = useState(false);
	// Once opened, the panel stays mounted so the conversation survives closing
	// and reopening — the chat state lives inside the lazily loaded module.
	const [hasOpened, setHasOpened] = useState(false);

	const toggle = useCallback((next: boolean) => {
		if (next) {
			setHasOpened(true);
		}
		setOpen(next);
	}, []);

	const onKeyPress = useEffectEvent((e: KeyboardEvent) => {
		if (e.key === "Escape" && open) {
			toggle(false);
			e.preventDefault();
		}

		if (e.key === "/" && (e.metaKey || e.ctrlKey) && !open) {
			toggle(true);
			e.preventDefault();
		}
	});

	useEffect(() => {
		window.addEventListener("keydown", onKeyPress);
		return () => window.removeEventListener("keydown", onKeyPress);
	}, []);

	return (
		<>
			{hasOpened && <AISearchPanel open={open} setOpen={toggle} />}
			<button
				type="button"
				data-state={open ? "open" : "closed"}
				className={cn(
					buttonVariants({
						color: "secondary",
						className: "text-fd-muted-foreground rounded-2xl",
					}),
					"fixed bottom-4 gap-3 w-24 inset-e-[calc(--spacing(4)+var(--removed-body-scroll-bar-size,0px))] shadow-lg z-20 transition-[translate,opacity]",
					open && "translate-y-10 opacity-0",
				)}
				onClick={() => toggle(!open)}
			>
				<MessageCircleIcon className="size-4.5" />
				Ask AI
			</button>
		</>
	);
}
