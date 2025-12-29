import { notFound } from "next/navigation";
import { getLocale, getMessages } from "next-intl/server";

import { Providers } from "@/components/providers";
import { getConfig } from "@/lib/config-server";

import { isValidLocale } from "@llmgateway/i18n/config";
import { IntlProvider } from "@llmgateway/i18n/provider";

import type { ReactNode } from "react";

export default async function LayoutWrapper({
	children,
}: {
	children: ReactNode;
}) {
	const locale = await getLocale();
	const messages = await getMessages();
	const config = getConfig();

	if (!isValidLocale(locale)) {
		notFound();
	}

	return (
		<IntlProvider locale={locale} messages={messages}>
			<Providers config={config}>{children}</Providers>
		</IntlProvider>
	);
}
