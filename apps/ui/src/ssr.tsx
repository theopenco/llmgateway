/// <reference types="vinxi/types/server" />
import { getRouterManifest } from "@tanstack/react-start/router-manifest";
import {
	createStartHandler,
	defaultStreamHandler,
} from "@tanstack/react-start/server";

import { createRouter } from "./router";

export default createStartHandler({
	// @ts-ignore
	createRouter,
	getRouterManifest,
})(defaultStreamHandler);
