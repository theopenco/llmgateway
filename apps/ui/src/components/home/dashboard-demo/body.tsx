"use client";

import { cn } from "@/lib/utils";

import { ActivityView } from "./activity-view";
import { AuditLogsView } from "./audit-logs-view";
import { useDemo } from "./context";
import { EnterpriseBanner } from "./controls";
import { GuardrailsView } from "./guardrails-view";
import { ModelUsageView } from "./model-usage-view";
import { OverviewView } from "./overview-view";
import { SecurityEventsView } from "./security-events-view";
import { DemoSidebarBody } from "./sidebar";
import { SsoView } from "./sso-view";
import { TeamView } from "./team-view";
import { DemoMobileHeader, DemoTopBar } from "./top-bar";

import type { LiveView } from "./nav";
import type { RefObject } from "react";

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

export function DemoBody({
	collapsed,
	onToggleSidebar,
	mobileNavOpen,
	onOpenMobileNav,
	onCloseMobileNav,
	mainRef,
}: {
	collapsed: boolean;
	onToggleSidebar: () => void;
	mobileNavOpen: boolean;
	onOpenMobileNav: () => void;
	onCloseMobileNav: () => void;
	mainRef: RefObject<HTMLDivElement | null>;
}) {
	const { view, project } = useDemo();
	const liveView = view as LiveView;
	const enterpriseNote = ENTERPRISE_NOTES[liveView];

	return (
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
				<DemoMobileHeader onOpenSidebar={onOpenMobileNav} />
				<DemoTopBar onToggleSidebar={onToggleSidebar} />
				{enterpriseNote && (
					<EnterpriseBanner view={liveView} message={enterpriseNote} />
				)}
				<div
					ref={mainRef}
					className="relative w-full min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-background"
				>
					<ViewContent key={`${view}-${project.id}`} view={liveView} />
				</div>
			</div>

			{mobileNavOpen && (
				<>
					<button
						type="button"
						aria-label="Close menu"
						onClick={onCloseMobileNav}
						className="absolute inset-0 z-40 bg-black/50 @3xl/demo:hidden"
					/>
					<div className="group absolute inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col bg-sidebar text-sidebar-foreground shadow-lg @3xl/demo:hidden">
						<DemoSidebarBody />
					</div>
				</>
			)}
		</>
	);
}
