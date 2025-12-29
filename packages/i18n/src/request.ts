import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { defaultLocale, isValidLocale } from "./config";

export default getRequestConfig(async () => {
	const cookieStore = await cookies();
	const locale = cookieStore.get("NEXT_LOCALE")?.value;

	const validLocale = locale && isValidLocale(locale) ? locale : defaultLocale;

	return {
		locale: validLocale,
		messages: (await import(`../messages/${validLocale}.json`)).default,
	};
});
