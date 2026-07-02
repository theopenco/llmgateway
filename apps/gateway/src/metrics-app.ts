import { Hono } from "hono";

import { getMetrics, getMetricsContentType } from "@llmgateway/instrumentation";

// Standalone Prometheus metrics app. This is served on a separate port
// (METRICS_PORT) that is only exposed inside the cluster, so the metrics are
// never reachable through the public gateway ingress.
export const metricsApp = new Hono();

metricsApp.get("/metrics", async (c) => {
	const metrics = await getMetrics();
	return c.text(metrics, 200, {
		"Content-Type": getMetricsContentType(),
	});
});
