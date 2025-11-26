import { Hono } from "hono";

import type { ServerTypes } from "@/vars.js";

export const responses = new Hono<ServerTypes>();

const errorMessage =
	"The Responses API is currently not supported. Please use the /v1/chat/completions API route instead.";

responses.post("/", (c) => {
	return c.text(errorMessage, 404);
});

responses.get("/:response_id", (c) => {
	return c.text(errorMessage, 404);
});
