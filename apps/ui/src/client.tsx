/// <reference types="vinxi/types/client" />
import { StartClient } from "@tanstack/react-start";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";

import { createRouter } from "./router";

const router = createRouter();

hydrateRoot(
	document,
	<StrictMode>
		{/* @ts-ignore */}
		<StartClient router={router} />
	</StrictMode>,
);
