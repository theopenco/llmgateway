"use client";

import { Loader2 } from "lucide-react";
import dynamic from "next/dynamic";

import { cn } from "@/lib/utils";

import { useDemo } from "./context";
import { EnterpriseBanner } from "./controls";
import { OverviewView } from "./overview-view";
import { DemoSidebarBody } from "./sidebar";
import { DemoMobileHeader, DemoTopBar } from "./top-bar";

import type { LiveView } from "./nav";
import type { RefObject } from "react";

function ViewLoading() {
	return (
		<div className="flex h-full items-center justify-center">
			<Loader2 className="size-5 animate-spin text-muted-foreground" />
		</div>
	);
}

// Only the overview shows until a visitor starts the demo, so every other view
// loads on first visit instead of in the homepage's hydration bundle.
const ActivityView = dynamic(
	() => import("./activity-view").then((m) => m.ActivityView),
	{ loading: ViewLoading },
);
const AgentsView = dynamic(
	() => import("./agents-view").then((m) => m.AgentsView),
	{ loading: ViewLoading },
);
const AnalyticsView = dynamic(
	() => import("./analytics-view").then((m) => m.AnalyticsView),
	{ loading: ViewLoading },
);
const ApiKeysView = dynamic(
	() => import("./api-keys-view").then((m) => m.ApiKeysView),
	{ loading: ViewLoading },
);
const AuditLogsView = dynamic(
	() => import("./audit-logs-view").then((m) => m.AuditLogsView),
	{ loading: ViewLoading },
);
const GuardrailsView = dynamic(
	() => import("./guardrails-view").then((m) => m.GuardrailsView),
	{ loading: ViewLoading },
);
const ModelUsageView = dynamic(
	() => import("./model-usage-view").then((m) => m.ModelUsageView),
	{ loading: ViewLoading },
);
const PreferencesView = dynamic(
	() => import("./preferences-view").then((m) => m.PreferencesView),
	{ loading: ViewLoading },
);
const RoutingView = dynamic(
	() => import("./routing-view").then((m) => m.RoutingView),
	{ loading: ViewLoading },
);
const SdkView = dynamic(() => import("./sdk-view").then((m) => m.SdkView), {
	loading: ViewLoading,
});
const SecurityEventsView = dynamic(
	() => import("./security-events-view").then((m) => m.SecurityEventsView),
	{ loading: ViewLoading },
);
const SsoView = dynamic(() => import("./sso-view").then((m) => m.SsoView), {
	loading: ViewLoading,
});
const TeamView = dynamic(() => import("./team-view").then((m) => m.TeamView), {
	loading: ViewLoading,
});
const UsageView = dynamic(
	() => import("./usage-view").then((m) => m.UsageView),
	{ loading: ViewLoading },
);

const ENTERPRISE_NOTES: Partial<Record<LiveView, string>> = {
	"settings/routing":
		"Routing weights, retries and priorities are Enterprise features, shown with sample data.",
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
		case "agents":
			return <AgentsView />;
		case "model-usage":
			return <ModelUsageView />;
		case "analytics":
			return <AnalyticsView />;
		case "usage":
			return <UsageView />;
		case "api-keys":
			return <ApiKeysView />;
		case "settings/preferences":
			return <PreferencesView />;
		case "settings/sdk":
			return <SdkView />;
		case "settings/routing":
			return <RoutingView />;
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
