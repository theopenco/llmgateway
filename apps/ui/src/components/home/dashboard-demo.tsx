"use client";

import { format } from "date-fns";
import { Lock, Maximize2, Minimize2, MousePointerClick, X } from "lucide-react";
import { usePostHog } from "posthog-js/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TooltipProvider } from "@/lib/components/tooltip";
import { cn } from "@/lib/utils";

import { ActivityView } from "./dashboard-demo/activity-view";
import { AuditLogsView } from "./dashboard-demo/audit-logs-view";
import { DemoProvider, type DemoContextValue } from "./dashboard-demo/context";
import { EnterpriseBanner } from "./dashboard-demo/controls";
import { GuardrailsView } from "./dashboard-demo/guardrails-view";
import { ModelUsageView } from "./dashboard-demo/model-usage-view";
import { findNavLink, isLiveView, type LiveView } from "./dashboard-demo/nav";
import { OverviewView } from "./dashboard-demo/overview-view";
import { SecurityEventsView } from "./dashboard-demo/security-events-view";
import { DemoSidebarBody } from "./dashboard-demo/sidebar";
import { SsoView } from "./dashboard-demo/sso-view";
import { TeamView } from "./dashboard-demo/team-view";
import { DemoMobileHeader, DemoTopBar } from "./dashboard-demo/top-bar";
import {
	DEMO_ANCHOR_DAY,
	DEMO_OPENED_AT,
	DEMO_ORG,
	DEMO_PROJECTS,
	buildDailyActivity,
	type DemoProject,
} from "./dashboard-demo-data";
import { TrackedLink } from "./tracked-link";

const ENTERPRISE_NOTES: Partial<Record<LiveView, string>> = {
	"org/team":
		"Member usage, limits and teams are Enterprise features, shown with sample data.",
	"org/guardrails": "Enterprise feature, shown with sample data.",
	"org/security-events": "Enterprise feature, shown with sample data.",
	"org/sso": "Enterprise feature, shown with sample data.",
	"org/audit-logs": "Enterprise feature, shown with sample data.",
};

function ViewContent({ view }: { view: LiveView }) {
	switch (view) {
		case "activity":
			return <ActivityView />;
		case "model-usage":
			return <ModelUsageView />;
		case "org/team":
			return <TeamView />;
		case "org/guardrails":
			return <GuardrailsView />;
		case "org/security-events":
			return (
				<div className="p-4 pt-6 md:p-8">
					<SecurityEventsView />
				</div>
			);
		case "org/sso":
			return <SsoView />;
		case "org/audit-logs":
			return (
				<div className="p-4 pt-6 md:p-8">
					<AuditLogsView />
				</div>
			);
		default:
			return <OverviewView />;
	}
}

interface Notice {
	id: number;
	message: string;
}

export function DashboardDemo() {
	const posthog = usePostHog();
	const [view, setView] = useState<LiveView>("");
	const [project, setProject] = useState<DemoProject>(DEMO_PROJECTS[0]);
	const [clock, setClock] = useState({
		anchorDay: DEMO_ANCHOR_DAY,
		openedAt: DEMO_OPENED_AT,
	});
	const [notice, setNotice] = useState<Notice | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [mobileNavOpen, setMobileNavOpen] = useState(false);
	const [unlocked, setUnlocked] = useState(false);
	const [hydrated, setHydrated] = useState(false);
	const [nativeFullscreen, setNativeFullscreen] = useState(false);
	const [windowFullscreen, setWindowFullscreen] = useState(false);
	const frameRef = useRef<HTMLDivElement>(null);
	const mainRef = useRef<HTMLDivElement>(null);
	const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	useEffect(() => {
		const now = new Date();
		setClock({ anchorDay: format(now, "yyyy-MM-dd"), openedAt: now.getTime() });
		setHydrated(true);
		return () => clearTimeout(noticeTimer.current);
	}, []);

	const history = useMemo(
		() => buildDailyActivity(clock.anchorDay, project),
		[clock.anchorDay, project],
	);

	const track = useCallback(
		(action: string, value: string) => {
			posthog.capture("hero_demo_interacted", { action, value });
		},
		[posthog],
	);

	const fullscreen = nativeFullscreen || windowFullscreen;

	useEffect(() => {
		const sync = () =>
			setNativeFullscreen(document.fullscreenElement === frameRef.current);
		document.addEventListener("fullscreenchange", sync);
		return () => document.removeEventListener("fullscreenchange", sync);
	}, []);

	useEffect(() => {
		if (!windowFullscreen) {
			return;
		}
		const root = document.documentElement;
		const previous = root.style.overflow;
		root.style.overflow = "hidden";
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setWindowFullscreen(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			root.style.overflow = previous;
			window.removeEventListener("keydown", onKey);
		};
	}, [windowFullscreen]);

	const exitFullscreen = () => {
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		}
		setWindowFullscreen(false);
	};

	const toggleFullscreen = () => {
		if (fullscreen) {
			exitFullscreen();
			track("fullscreen", "exit");
			return;
		}
		track("fullscreen", "enter");
		const frame = frameRef.current;
		if (frame?.requestFullscreen) {
			frame.requestFullscreen().catch(() => setWindowFullscreen(true));
			return;
		}
		setWindowFullscreen(true);
	};

	const start = () => {
		setUnlocked(true);
		track("start", view || "dashboard");
	};

	const lock = () => {
		exitFullscreen();
		setMobileNavOpen(false);
		setNotice(null);
		setUnlocked(false);
		track("lock", view || "dashboard");
	};

	const notify = (message: string) => {
		clearTimeout(noticeTimer.current);
		setNotice((current) => ({ id: (current?.id ?? 0) + 1, message }));
		noticeTimer.current = setTimeout(() => setNotice(null), 4000);
	};

	const navigate = (target: string) => {
		if (isLiveView(target)) {
			setView(target);
			setMobileNavOpen(false);
			mainRef.current?.scrollTo({ top: 0 });
			track("view", target || "dashboard");
			return;
		}
		track("view_unavailable", target);
		notify(
			`${findNavLink(target)?.label ?? "This page"} isn't part of this demo.`,
		);
	};

	const context: DemoContextValue = {
		view,
		navigate,
		notify,
		track,
		openedAt: clock.openedAt,
		anchorDay: clock.anchorDay,
		project,
		selectProject: (next) => {
			setProject(next);
			track("project", next.id);
		},
		history,
	};

	const enterpriseNote = ENTERPRISE_NOTES[view];
	const path = view.startsWith("org/")
		? `${DEMO_ORG.id}/${view}`
		: `${DEMO_ORG.id}/${project.id}${view ? `/${view}` : ""}`;

	return (
		<DemoProvider value={context}>
			<TooltipProvider delayDuration={0}>
				<div
					ref={frameRef}
					data-window-fullscreen={windowFullscreen || undefined}
					className={cn(
						"@container/demo flex flex-col overflow-hidden border-black/10 bg-background text-foreground dark:border-white/10",
						fullscreen
							? "h-dvh w-full"
							: "rounded-2xl border shadow-[0_40px_100px_-50px_rgba(17,17,19,0.45)] dark:shadow-[0_40px_120px_-50px_rgba(0,0,0,0.9)]",
						windowFullscreen && "fixed inset-0 z-[100]",
					)}
				>
					<div className="flex h-10 items-center gap-3 border-b border-border bg-muted/50 px-3">
						<div aria-hidden className="flex shrink-0 gap-1.5">
							<span className="size-2.5 rounded-full bg-foreground/15" />
							<span className="size-2.5 rounded-full bg-foreground/15" />
							<span className="size-2.5 rounded-full bg-foreground/15" />
						</div>
						<div className="mx-auto hidden min-w-0 max-w-md flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 py-1 font-mono text-[11px] text-muted-foreground @xl/demo:flex">
							<Lock className="size-3 shrink-0" />
							<span className="truncate">llmgateway.io/dashboard/{path}</span>
						</div>
						<span className="ml-auto hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground @md/demo:inline @xl/demo:ml-0">
							Sample data · read-only
						</span>
						{unlocked && (
							<div className="ml-auto flex shrink-0 items-center gap-1 @md/demo:ml-0">
								<button
									type="button"
									onClick={toggleFullscreen}
									aria-label={fullscreen ? "Exit full screen" : "Full screen"}
									className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									{fullscreen ? (
										<Minimize2 className="size-3.5" />
									) : (
										<Maximize2 className="size-3.5" />
									)}
									<span className="hidden @xl/demo:inline">
										{fullscreen ? "Exit full screen" : "Full screen"}
									</span>
								</button>
								<button
									type="button"
									onClick={lock}
									aria-label="Lock demo"
									className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<Lock className="size-3.5" />
									<span className="hidden @xl/demo:inline">Lock</span>
								</button>
							</div>
						)}
					</div>

					<div className="relative min-h-0 flex-1">
						<div
							inert={!unlocked}
							className={cn(
								"relative flex bg-sidebar",
								fullscreen ? "h-full" : "h-[560px] md:h-[680px]",
							)}
						>
							{hydrated && (
								<>
									<aside
										data-state={collapsed ? "collapsed" : "expanded"}
										data-collapsible={collapsed ? "icon" : ""}
										data-variant="inset"
										className={cn(
											"group hidden shrink-0 text-sidebar-foreground transition-[width] duration-200 ease-linear @3xl/demo:block",
											collapsed ? "w-[calc(3rem+1rem+2px)]" : "w-64",
										)}
									>
										<div className="flex h-full w-full flex-col p-2">
											<div
												data-sidebar="sidebar"
												className="flex h-full w-full flex-col overflow-hidden bg-sidebar"
											>
												<DemoSidebarBody collapsed={collapsed} />
											</div>
										</div>
									</aside>

									<div className="flex min-w-0 flex-1 flex-col">
										<DemoMobileHeader
											onOpenSidebar={() => setMobileNavOpen(true)}
										/>
										<DemoTopBar
											onToggleSidebar={() => {
												setCollapsed(!collapsed);
												track("sidebar", collapsed ? "expand" : "collapse");
											}}
										/>
										{enterpriseNote && (
											<EnterpriseBanner view={view} message={enterpriseNote} />
										)}
										<div
											ref={mainRef}
											className="relative w-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background"
										>
											<ViewContent key={`${view}-${project.id}`} view={view} />
										</div>
									</div>
								</>
							)}

							{mobileNavOpen && (
								<>
									<button
										type="button"
										aria-label="Close menu"
										onClick={() => setMobileNavOpen(false)}
										className="absolute inset-0 z-40 bg-black/50 @3xl/demo:hidden"
									/>
									<div className="group absolute inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col bg-sidebar text-sidebar-foreground shadow-lg @3xl/demo:hidden">
										<DemoSidebarBody />
									</div>
								</>
							)}

							{notice && (
								<div
									key={notice.id}
									role="status"
									className="absolute inset-x-3 bottom-3 z-50 flex items-center gap-3 rounded-lg border border-border bg-popover px-4 py-2.5 text-sm text-popover-foreground shadow-lg animate-in fade-in-0 slide-in-from-bottom-2 @xl/demo:inset-x-auto @xl/demo:left-1/2 @xl/demo:-translate-x-1/2"
								>
									<span className="min-w-0 flex-1 @xl/demo:whitespace-nowrap">
										{notice.message}
									</span>
									<TrackedLink
										href="/signup"
										auth
										location="home_demo"
										cta="demo_notice_signup"
										className="shrink-0 font-medium underline underline-offset-4"
									>
										Try it free
									</TrackedLink>
									<button
										type="button"
										aria-label="Dismiss"
										onClick={() => setNotice(null)}
										className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
									>
										<X className="h-4 w-4" />
									</button>
								</div>
							)}
						</div>
						{!unlocked && (
							<button
								type="button"
								onClick={start}
								className="group absolute inset-0 z-[60] flex items-center justify-center bg-gradient-to-b from-background/10 via-background/30 to-background/70 focus-visible:outline-none"
							>
								<span className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-background/90 px-6 py-5 text-center shadow-xl backdrop-blur-sm transition-transform group-hover:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-ring">
									<span className="text-base font-semibold">
										Explore the dashboard
									</span>
									<span className="max-w-64 text-sm text-muted-foreground">
										A read-only copy with sample data. Click through every page.
									</span>
									<span className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background">
										<MousePointerClick className="size-4" />
										Start demo
									</span>
								</span>
							</button>
						)}
					</div>
				</div>
			</TooltipProvider>
		</DemoProvider>
	);
}
