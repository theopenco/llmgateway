"use client";

import { providerUptimeBadge } from "@/lib/badges";
import { useAppConfig } from "@/lib/config";

import { BadgeSnippet } from "./badge-snippet";

export function ProviderUptimeEmbed({
	id,
	name,
}: {
	id: string;
	name: string;
}) {
	const { apiUrl } = useAppConfig();
	return <BadgeSnippet badge={providerUptimeBadge(apiUrl, { id, name })} />;
}
