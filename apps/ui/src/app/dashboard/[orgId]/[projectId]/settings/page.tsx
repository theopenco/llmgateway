"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";

export default function SettingsPage() {
	const router = useRouter();
	const { buildUrl } = useDashboardNavigation();

	useEffect(() => {
		router.replace(buildUrl("settings/preferences"));
	}, [router, buildUrl]);

	return null;
}
