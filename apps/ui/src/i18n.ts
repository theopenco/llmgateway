import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { defaultLocale, isValidLocale } from "@llmgateway/i18n/config";

export default getRequestConfig(async () => {
	const cookieStore = await cookies();
	const locale = cookieStore.get("NEXT_LOCALE")?.value;

	const validLocale = locale && isValidLocale(locale) ? locale : defaultLocale;

	let messages;
	switch (validLocale) {
		case "fa":
			messages = (await import("@llmgateway/i18n/messages/fa")).default;
			break;
		case "ar":
			messages = (await import("@llmgateway/i18n/messages/ar")).default;
			break;
		default:
			messages = (await import("@llmgateway/i18n/messages/en")).default;
	}

	return {
		locale: validLocale,
		messages,
	};
});
