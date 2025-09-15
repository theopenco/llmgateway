import { OpenAPIHono } from "@hono/zod-openapi";

import { apiAuth as auth } from "@/auth/config";

import { activity } from "./activity";
import { chat } from "./chat";
import { chats } from "./chats";
import keysApi from "./keys-api";
import keysProvider from "./keys-provider";
import { logs } from "./logs";
import organization from "./organization";
import { payments } from "./payments";
import projects from "./projects";
import { subscriptions } from "./subscriptions";
import { user } from "./user";

import type { ServerTypes } from "@/vars";

export const routes = new OpenAPIHono<ServerTypes>();

// Middleware to verify authentication
routes.use("/*", async (c, next) => {
	const session = await auth.api.getSession({ headers: c.req.raw.headers });

	if (!session?.user) {
		return c.json({ message: "Unauthorized" }, 401);
	}

	c.set("user", session.user);
	c.set("session", session.session);

	return await next();
});

routes.route("/user", user);

routes.route("/logs", logs);

routes.route("/activity", activity);

routes.route("/keys", keysApi);
routes.route("/keys", keysProvider);
routes.route("/projects", projects);

routes.route("/orgs", organization);
routes.route("/payments", payments);
routes.route("/chat", chat);
routes.route("/chats", chats);
routes.route("/subscriptions", subscriptions);
