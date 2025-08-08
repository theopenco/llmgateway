import { loader } from "fumadocs-core/source";
import { createOpenAPI, attachFile } from "fumadocs-openapi/server";

import { docs } from "@/.source";

export const source = loader({
	baseUrl: "/",
	source: docs.toFumadocsSource(),
	pageTree: {
		attachFile,
	},
});

export const openapi = createOpenAPI({
	proxyUrl: "/api/proxy",
});
