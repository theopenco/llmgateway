"use client";

import { usePostHog } from "posthog-js/react";
import { type ReactNode, useEffect } from "react";

import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { MobileHeader } from "@/components/dashboard/mobile-header";
import { TopBar } from "@/components/dashboard/top-bar";
import { EmailVerificationBanner } from "@/components/email-verification-banner";
import { useDashboardState } from "@/lib/dashboard-state";

interface DashboardLayoutClientProps {
	children: ReactNode;
	initialOrganizationsData?: unknown;
	initialProjectsData?: unknown;
	selectedOrgId?: string;
	selectedProjectId?: string;
}

export function DashboardLayoutClient({
	children,
	initialOrganizationsData,
	initialProjectsData,
	selectedOrgId,
	selectedProjectId,
}: DashboardLayoutClientProps) {
	const posthog = usePostHog();

	const {
		organizations,
		projects,
		selectedProject,
		selectedOrganization,
		handleOrganizationSelect,
		handleProjectSelect,
		handleOrganizationCreated,
		handleProjectCreated,
	} = useDashboardState({
		initialOrganizationsData,
		initialProjectsData,
		selectedOrgId,
		selectedProjectId,
	});

	useEffect(() => {
		posthog.capture("page_viewed_dashboard");
	}, [posthog]);

	return (
		<div className="flex min-h-screen w-full flex-col">
			<MobileHeader />
			<div className="flex flex-1">
				<DashboardSidebar
					organizations={organizations}
					onSelectOrganization={handleOrganizationSelect}
					onOrganizationCreated={handleOrganizationCreated}
					selectedOrganization={selectedOrganization}
				/>
				<div className="flex flex-1 flex-col justify-center">
					<TopBar
						projects={projects}
						selectedProject={selectedProject}
						onSelectProject={handleProjectSelect}
						selectedOrganization={selectedOrganization}
						onProjectCreated={handleProjectCreated}
					/>
					<EmailVerificationBanner />
					<main className="bg-background w-full flex-1 overflow-y-auto pt-10 pb-4 px-4 md:p-6 lg:p-8">
						{children}
					</main>
				</div>
			</div>
		</div>
	);
}
