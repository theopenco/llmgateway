"use client";

import { useEffect } from "react";

import { setLastUsedProjectAction } from "@/lib/actions/project";

interface LastUsedProjectTrackerProps {
	orgId: string;
	projectId: string;
}

/**
 * Client component that tracks the last used project by calling a Server Action
 */
export function LastUsedProjectTracker({
	orgId,
	projectId,
}: LastUsedProjectTrackerProps) {
	useEffect(() => {
		// Set the last used project when the component mounts
		setLastUsedProjectAction(orgId, projectId).catch((error) => {
			console.error("Failed to set last used project:", error);
		});
	}, [orgId, projectId]);

	// This component doesn't render anything
	return null;
}
