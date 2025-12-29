export const locales = ["en", "fa", "ar"] as const;
export const defaultLocale = "en" as const;

export type Locale = (typeof locales)[number];

export const rtlLocales: Locale[] = ["fa", "ar"];

export function isRtlLocale(locale: string): boolean {
	return rtlLocales.includes(locale as Locale);
}

export function isValidLocale(locale: string): locale is Locale {
	return locales.includes(locale as Locale);
}
