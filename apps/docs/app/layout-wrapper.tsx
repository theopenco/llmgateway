import { RootProvider } from "fumadocs-ui/provider/next";
import { notFound } from "next/navigation";
import { getLocale, getMessages } from "next-intl/server";

import { ConfigProvider } from "@/lib/context";
import { PostHogProvider } from "@/lib/providers";

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
	const posthogKey = process.env.POSTHOG_KEY || "";
	const posthogHost = process.env.POSTHOG_HOST || "";

	if (!isValidLocale(locale)) {
		notFound();
	}

	return (
		<IntlProvider locale={locale} messages={messages}>
			<ConfigProvider posthogKey={posthogKey} posthogHost={posthogHost}>
				<PostHogProvider>
					<RootProvider
						theme={{
							defaultTheme: "system",
						}}
					>
						{children}
					</RootProvider>
				</PostHogProvider>
			</ConfigProvider>
		</IntlProvider>
	);
}
