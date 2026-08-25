import { OpenAPIHono } from "@hono/zod-openapi";

import { apiAuth as auth } from "@/auth/config.js";

import { activity } from "./activity.js";
import { adminAirside } from "./admin-airside.js";
import { adminLicense } from "./admin-license.js";
import { adminLimitHits } from "./admin-limit-hits.js";
import { adminOrgDetails } from "./admin-org-details.js";
import adminProviderCredentials from "./admin-provider-credentials.js";
import { adminRoutingAnalytics } from "./admin-routing-analytics.js";
import admin from "./admin.js";
import { airside } from "./airside.js";
import { analytics } from "./analytics.js";
import { auditLogs } from "./audit-logs.js";
import { chatPlans } from "./chat-plans.js";
import { chatProjects } from "./chat-projects.js";
import { chat } from "./chat.js";
import { chats } from "./chats.js";
import { customModels } from "./custom-models.js";
import { devPlanCancellationFeedback } from "./dev-plan-cancellation-feedback.js";
import { devPlans } from "./dev-plans.js";
import { dynamicRoutes } from "./dynamic-routes.js";
import { escape } from "./escape.js";
import { guardrails } from "./guardrails.js";
import keysApi from "./keys-api.js";
import keysProvider from "./keys-provider.js";
import { logs } from "./logs.js";
import { lounge } from "./lounge.js";
import masterKeys from "./master-keys.js";
import { modelRatings } from "./model-ratings.js";
import { modelSurvey } from "./model-survey.js";
import organization from "./organization.js";
import { payments } from "./payments.js";
import playground from "./playground.js";
import projects from "./projects.js";
import { routingConfig } from "./routing-config.js";
import { skills } from "./skills.js";
import { sso } from "./sso.js";
import { subscriptions } from "./subscriptions.js";
import team from "./team.js";
import { user } from "./user.js";
import { video } from "./video.js";

import type { ServerTypes } from "@/vars.js";

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

routes.route("/admin", adminLicense);
routes.route("/admin", admin);
routes.route("/admin", adminProviderCredentials);
routes.route("/admin", adminOrgDetails);
routes.route("/admin", adminRoutingAnalytics);
routes.route("/admin", adminLimitHits);
routes.route("/admin", adminAirside);

routes.route("/airside", airside);

routes.route("/analytics", analytics);

routes.route("/keys", keysApi);
routes.route("/keys", keysProvider);
routes.route("/master-keys", masterKeys);
routes.route("/projects", projects);
routes.route("/playground", playground);

routes.route("/orgs", organization);
routes.route("/team", team);
routes.route("/payments", payments);
routes.route("/chat", chat);
routes.route("/chats", chats);
routes.route("/chat-projects", chatProjects);
routes.route("/skills", skills);
routes.route("/subscriptions", subscriptions);
routes.route("/dev-plans", devPlans);
routes.route("/dev-plan-cancellation-feedback", devPlanCancellationFeedback);
routes.route("/chat-plans", chatPlans);
routes.route("/lounge", lounge);
routes.route("/escape", escape);
routes.route("/audit-logs", auditLogs);
routes.route("/model-ratings", modelRatings);
routes.route("/model-survey", modelSurvey);
routes.route("/guardrails", guardrails);
routes.route("/routing-config", routingConfig);
routes.route("/dynamic-routes", dynamicRoutes);
routes.route("/custom-models", customModels);
routes.route("/video", video);
routes.route("/sso", sso);
