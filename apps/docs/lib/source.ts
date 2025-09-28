import { loader } from "fumadocs-core/source";
import { createOpenAPI, attachFile } from "fumadocs-openapi/server";
import { icons } from "lucide-react";
import { createElement } from "react";

import { customIcons } from "./custom-icons";
import { docs } from "@/.source";

export const source = loader({
	icon(icon) {
		if (!icon) {
			return undefined;
		}
		if (icon in icons) {
			return createElement(icons[icon as keyof typeof icons]);
		}

		if (icon in customIcons) {
			const C = customIcons[icon];
			return createElement(C);
		}

		return undefined;
	},
	baseUrl: "/",
	source: docs.toFumadocsSource(),
	pageTree: {
		attachFile,
	},
});

export const openapi = createOpenAPI({
	proxyUrl: "/api/proxy",
});
