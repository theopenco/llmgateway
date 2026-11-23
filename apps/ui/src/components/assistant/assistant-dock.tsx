"use client";

import { Decimal } from "decimal.js";
import { useCallback, useEffect, useState } from "react";

import { AssistantSpotlight } from "@/components/assistant/assistant-spotlight";
import { useDashboardTools } from "@/components/assistant/use-dashboard-tools";
import { cn } from "@/lib/utils";

import "./assistant.css";

import type { AssistantPanel as AssistantPanelComponent } from "@/components/assistant/assistant-panel";

// The panel carries the AI SDK and voice input; like the chat support widget,
// it loads on intent instead of shipping in every dashboard page's bundle.
const loadAssistantPanel = () =>
	import("@/components/assistant/assistant-panel").then(
		(mod) => mod.AssistantPanel,
	);

/**
 * Autopilot: a docked co-pilot that shows where things are and, with the
 * user's approval, does them through the page's WebMCP tools. Offered to
 * organizations with credits, which is what its model calls are billed to.
 */
export function AssistantDock() {
	const { organization, project } = useDashboardTools();
	const [open, setOpen] = useState(false);
	const [Panel, setPanel] = useState<typeof AssistantPanelComponent | null>(
		null,
	);
	const [loading, setLoading] = useState(false);
	// The balance is only disclosed to owners and admins, so they are who
	// sees the dock; the API checks credits and project access again.
	const hasCredits = new Decimal(organization?.credits ?? 0).greaterThan(0);

	const prefetch = () => {
		loadAssistantPanel().catch((error: unknown) => {
			console.error("Failed to prefetch the assistant panel:", error);
		});
	};

	const show = useCallback(() => {
		if (Panel) {
			setOpen(true);
			return;
		}
		if (loading) {
			return;
		}
		setLoading(true);
		loadAssistantPanel()
			.then((component) => {
				setPanel(() => component);
				setOpen(true);
			})
			.catch((error: unknown) => {
				console.error("Failed to load the assistant panel:", error);
			})
			.finally(() => setLoading(false));
	}, [Panel, loading]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
				event.preventDefault();
				if (open) {
					setOpen(false);
				} else {
					show();
				}
			}
			if (
				event.key === "Escape" &&
				event.target instanceof Element &&
				event.target.closest("[data-assistant-root]")
			) {
				setOpen(false);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, show]);

	if (!organization || !project || !hasCredits) {
		return null;
	}

	return (
		<>
			<AssistantSpotlight />
			<div
				data-assistant-root
				className={cn(
					"pointer-events-none fixed inset-x-0 z-[46] flex justify-center px-3",
					// Clear the support bubble where the open dock spans the screen.
					open ? "bottom-20 md:bottom-4" : "bottom-4",
				)}
			>
				<div
					className={cn(
						"pointer-events-auto",
						open ? "w-full max-w-[620px]" : "w-auto",
					)}
				>
					{/* Kept mounted while collapsed so the conversation survives. */}
					{Panel && (
						<div className={open ? undefined : "hidden"}>
							{/* Keyed by organization: only that starts a new conversation. */}
							<Panel
								key={organization.id}
								organization={organization}
								project={project}
								active={open}
								onClose={() => setOpen(false)}
							/>
						</div>
					)}
					{!open && (
						<button
							type="button"
							data-testid="assistant-launcher"
							onClick={show}
							onPointerEnter={prefetch}
							onFocus={prefetch}
							aria-busy={loading}
							aria-label="Open Autopilot assistant"
							aria-keyshortcuts="Meta+J Control+J"
							className="assistant-dock assistant-panel group flex h-12 items-center gap-2.5 rounded-full pr-2 pl-4 text-white transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none"
						>
							<span className="assistant-orb size-3 rounded-full" aria-hidden />
							<span className="font-mono text-[11px] font-semibold tracking-[0.22em] uppercase">
								Autopilot
							</span>
							<span className="hidden text-sm text-white/55 sm:inline">
								Ask or say what to do
							</span>
							<kbd className="hidden rounded-full bg-white/10 px-2 py-1 font-mono text-[10px] text-white/70 sm:inline">
								⌘J
							</kbd>
						</button>
					)}
				</div>
			</div>
		</>
	);
}
