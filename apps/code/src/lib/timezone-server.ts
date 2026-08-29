import { cookies } from "next/headers";

import { parseTimeZoneCookie, TIMEZONE_COOKIE_NAME } from "@llmgateway/shared";

import type { TimeZonePreference } from "@llmgateway/shared";

/** Read the display-timezone preference server-side so the first paint already
 *  renders in the right zone — no browser sends its zone in a header, so the
 *  cookie is the only way the server can know it. */
export async function getTimeZonePreference(): Promise<TimeZonePreference> {
	const cookieStore = await cookies();
	return parseTimeZoneCookie(cookieStore.get(TIMEZONE_COOKIE_NAME)?.value);
}
