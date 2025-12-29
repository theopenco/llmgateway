"use client";

import { useLocale } from "next-intl";
import { useTransition } from "react";

import { locales, type Locale } from "@llmgateway/i18n/config";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "./ui/select";

const localeNames: Record<Locale, string> = {
	en: "En",
	fa: "Fa",
	ar: "Ar",
};

export function LanguageSelector() {
	const locale = useLocale() as Locale;
	const [isPending, startTransition] = useTransition();

	function handleLocaleChange(newLocale: string) {
		startTransition(() => {
			document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; SameSite=Lax`;
			window.location.reload();
		});
	}

	return (
		<Select value={locale} onValueChange={handleLocaleChange}>
			<SelectTrigger
				className="w-[140px]"
				disabled={isPending}
				aria-label="Select language"
			>
				{/* <Globe className="mr-2 h-4 w-4" /> */}
				<SelectValue placeholder="Language" />
			</SelectTrigger>
			<SelectContent>
				{locales.map((loc) => (
					<SelectItem key={loc} value={loc}>
						{localeNames[loc]}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
