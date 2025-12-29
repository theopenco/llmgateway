"use client";

import { NextIntlClientProvider } from "next-intl";

import type { ReactNode } from "react";

interface IntlProviderProps {
	children: ReactNode;
	locale: string;
	messages: Record<string, unknown>;
}

export function IntlProvider({
	children,
	locale,
	messages,
}: IntlProviderProps) {
	return (
		<NextIntlClientProvider locale={locale} messages={messages}>
			{children}
		</NextIntlClientProvider>
	);
}
