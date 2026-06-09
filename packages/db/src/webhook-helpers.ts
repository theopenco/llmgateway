import { db } from "./db.js";
import { platformWebhookDelivery, shortid } from "./schema.js";

/**
 * LLM SDK: enqueue a platform webhook event for delivery to every active
 * endpoint of a project subscribed to that event type. Best-effort — callers
 * should not fail their main operation if this throws.
 *
 * Returns the generated event id (shared across all endpoint deliveries) and the
 * number of deliveries queued.
 */
export async function enqueueWebhookDeliveries(params: {
	projectId: string;
	eventType: string;
	data: Record<string, unknown>;
}): Promise<{ eventId: string; queued: number }> {
	const { projectId, eventType, data } = params;

	const endpoints = await db.query.webhookEndpoint.findMany({
		where: { projectId: { eq: projectId }, status: { eq: "active" } },
	});

	const subscribed = endpoints.filter(
		(e) =>
			!e.enabledEvents ||
			e.enabledEvents.length === 0 ||
			e.enabledEvents.includes(eventType),
	);

	const eventId = `evt_${shortid(24)}`;
	if (subscribed.length === 0) {
		return { eventId, queued: 0 };
	}

	const payload: Record<string, unknown> = {
		id: eventId,
		type: eventType,
		data,
	};

	await db.insert(platformWebhookDelivery).values(
		subscribed.map((e) => ({
			webhookEndpointId: e.id,
			eventId,
			eventType,
			payload,
		})),
	);

	return { eventId, queued: subscribed.length };
}
