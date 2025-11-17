import { createAPIPage } from "fumadocs-openapi/ui";

import { openapi } from "@/lib/source";

import client from "./api-page.client";

export const APIPage = createAPIPage(openapi, {
	client,
});
