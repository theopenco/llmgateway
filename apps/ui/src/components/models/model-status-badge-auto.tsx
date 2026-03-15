"use client";

import { ModelStatusBadge } from "@/components/models/model-status-badge";

interface ProviderDateInfo {
	deprecatedAt?: Date | string | null;
	deactivatedAt?: Date | string | null;
}

interface ModelStatusBadgeAutoProps {
	providers: ProviderDateInfo[];
}

export function ModelStatusBadgeAuto({ providers }: ModelStatusBadgeAutoProps) {
	if (providers.length === 0) {
		return null;
	}

	const now = new Date();

	const allHaveDeactivatedAt = providers.every((p) => p.deactivatedAt);
	const allHaveDeprecatedAt = providers.every((p) => p.deprecatedAt);

	if (allHaveDeactivatedAt) {
		const allPast = providers.every((p) => new Date(p.deactivatedAt!) <= now);
		return <ModelStatusBadge status="deactivated" isPast={allPast} />;
	}

	if (allHaveDeprecatedAt) {
		const allPast = providers.every((p) => new Date(p.deprecatedAt!) <= now);
		return <ModelStatusBadge status="deprecated" isPast={allPast} />;
	}

	return null;
}
