"use client";

import { createContext, use } from "react";

import type { DemoProject } from "@/components/home/dashboard-demo-data";
import type { DailyActivity } from "@/types/activity";

export interface DemoContextValue {
	view: string;
	navigate: (view: string) => void;
	notify: (message: string) => void;
	track: (action: string, value: string) => void;
	openedAt: number;
	anchorDay: string;
	project: DemoProject;
	selectProject: (project: DemoProject) => void;
	history: DailyActivity[];
}

const DemoContext = createContext<DemoContextValue | null>(null);

export const DemoProvider = DemoContext;

export function useDemo(): DemoContextValue {
	const value = use(DemoContext);
	if (!value) {
		throw new Error("useDemo must be used within the dashboard demo");
	}
	return value;
}

export const READ_ONLY_MESSAGE = "This demo is read-only, so nothing is saved.";
