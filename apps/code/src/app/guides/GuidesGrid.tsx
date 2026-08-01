"use client";

import { IntegrationGuidesGrid } from "@llmgateway/shared/components";

export function GuidesGrid({ uiUrl }: { uiUrl: string }) {
	return <IntegrationGuidesGrid internalHrefPrefix={uiUrl} />;
}
