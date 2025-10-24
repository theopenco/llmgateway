"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Organization, Project } from "@/lib/types";

interface DashboardContextType {
	organizations: Organization[];
	projects: Project[];
	selectedOrganization: Organization | null;
	selectedProject: Project | null;
	handleOrganizationSelect: (org: Organization | null) => void;
	handleProjectSelect: (project: Project | null) => void;
	handleOrganizationCreated: (org: Organization) => void;
	handleProjectCreated: (project: Project) => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(
	undefined,
);

export function DashboardProvider({
	children,
	value,
}: {
	children: ReactNode;
	value: DashboardContextType;
}) {
	return (
		<DashboardContext.Provider value={value}>
			{children}
		</DashboardContext.Provider>
	);
}

export const useDashboardContext = () => {
	const context = useContext(DashboardContext);
	if (!context) {
		throw new Error(
			"useDashboardContext must be used within DashboardProvider",
		);
	}
	return context;
};

export { DashboardContext };
export type { DashboardContextType };
