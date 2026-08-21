import { z } from "zod";

import { models, providers } from "@llmgateway/models";

import {
	CUSTOM_PROVIDER_NAME_REGEX,
	RESERVED_CUSTOM_PROVIDER_NAMES,
} from "./custom-providers.js";

/**
 * Reserved model-string prefix that invokes a named dynamic route instead of a
 * concrete model, e.g. `"model": "dynamic/support"`. The prefix is also a
 * reserved custom-provider name so a BYOK custom provider can never shadow it.
 */
export const DYNAMIC_ROUTE_PREFIX = "dynamic/";

export const DYNAMIC_ROUTE_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const DYNAMIC_ROUTE_NAME_MESSAGE =
	"Route name must contain only lowercase letters, digits and single hyphens between them";

/**
 * Hard bound on nodes visited during a single evaluation so a malformed or
 * adversarial graph can never loop forever at request time.
 */
export const DYNAMIC_ROUTE_MAX_HOPS = 50;

export const DYNAMIC_ROUTE_MAX_NODES = 100;

export interface CustomDynamicRouteModelRef {
	providerName: string;
	modelName: string;
}

/**
 * Parses the `<custom-provider>/<model>` reference stored by a model node.
 * Official provider-prefixed model strings are intentionally excluded: model
 * nodes store official canonical model ids and use `providers` for restrictions.
 */
export function parseCustomDynamicRouteModelRef(
	model: string,
): CustomDynamicRouteModelRef | undefined {
	const separator = model.indexOf("/");
	if (separator <= 0 || separator === model.length - 1) {
		return undefined;
	}
	const providerName = model.slice(0, separator);
	if (
		!CUSTOM_PROVIDER_NAME_REGEX.test(providerName) ||
		(RESERVED_CUSTOM_PROVIDER_NAMES as readonly string[]).includes(
			providerName,
		) ||
		providers.some((provider) => provider.id === providerName)
	) {
		return undefined;
	}
	return { providerName, modelName: model.slice(separator + 1) };
}

// Restricted so ids stay safe to embed in composite identifiers (the visual
// editor derives edge ids as `<nodeId>:<handle>`).
const nodeIdSchema = z
	.string()
	.min(1)
	.max(64)
	.regex(
		/^[a-zA-Z0-9_-]+$/,
		"Node ids may only contain letters, digits, hyphens and underscores",
	);

/**
 * A model node resolves the route to a single catalog model. When `providers`
 * is set, provider selection is restricted to (and ordered fallback happens
 * across) exactly those providers; when omitted, all providers serving the
 * model are candidates and normal weighted scoring applies.
 */
const modelNodeSchema = z.object({
	id: nodeIdSchema,
	type: z.literal("model"),
	model: z.string().min(1),
	providers: z.array(z.string().min(1)).min(1).optional(),
});

export const DYNAMIC_ROUTE_METADATA_PATHS = [
	"orgId",
	"projectId",
	"apiKeyId",
	"plan",
] as const;

const conditionFieldSchema = z.object({
	/**
	 * - `header`: request header (path = header name, case-insensitive)
	 * - `body`: dot-path into the JSON request body (e.g. "metadata.plan")
	 * - `metadata`: gateway request context; path is one of
	 *   DYNAMIC_ROUTE_METADATA_PATHS
	 */
	source: z.enum(["header", "body", "metadata"]),
	path: z.string().min(1).max(256),
});

const conditionValueSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.string()),
]);

const conditionSchema = z
	.object({
		field: conditionFieldSchema,
		op: z.enum(["eq", "neq", "in", "contains", "gt", "lt", "exists"]),
		value: conditionValueSchema.optional(),
		next: nodeIdSchema,
	})
	.superRefine((condition, ctx) => {
		if (
			condition.field.source === "metadata" &&
			!(DYNAMIC_ROUTE_METADATA_PATHS as readonly string[]).includes(
				condition.field.path,
			)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Metadata path must be one of: ${DYNAMIC_ROUTE_METADATA_PATHS.join(", ")}`,
				path: ["field", "path"],
			});
		}
		if (condition.op === "exists") {
			if (condition.value !== undefined) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Operator "exists" must not have a value`,
					path: ["value"],
				});
			}
			return;
		}
		if (condition.value === undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Operator "${condition.op}" requires a value`,
				path: ["value"],
			});
			return;
		}
		if (condition.op === "in" && !Array.isArray(condition.value)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Operator "in" requires an array value`,
				path: ["value"],
			});
		}
		if (condition.op !== "in" && Array.isArray(condition.value)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Operator "${condition.op}" does not accept an array value`,
				path: ["value"],
			});
		}
		if (
			(condition.op === "gt" || condition.op === "lt") &&
			typeof condition.value !== "number"
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Operator "${condition.op}" requires a numeric value`,
				path: ["value"],
			});
		}
	});

const conditionalNodeSchema = z.object({
	id: nodeIdSchema,
	type: z.literal("conditional"),
	/** Evaluated in order; the first matching condition's `next` is followed. */
	conditions: z.array(conditionSchema).min(1).max(20),
	/** Followed when no condition matches. */
	else: nodeIdSchema,
});

const percentageSplitSchema = z.object({
	/** Relative weight; splits are normalized over the sum of all weights. */
	weight: z.number().positive().finite(),
	next: nodeIdSchema,
});

const percentageNodeSchema = z.object({
	id: nodeIdSchema,
	type: z.literal("percentage"),
	splits: z.array(percentageSplitSchema).min(2).max(20),
});

/**
 * Terminating a route at an `end` node means the route resolved to no model
 * and the request fails with a 400. Useful as an explicit "reject" branch.
 */
const endNodeSchema = z.object({
	id: nodeIdSchema,
	type: z.literal("end"),
});

const nodeSchema = z.discriminatedUnion("type", [
	modelNodeSchema,
	conditionalNodeSchema,
	percentageNodeSchema,
	endNodeSchema,
]);

export type DynamicRouteModelNode = z.infer<typeof modelNodeSchema>;
export type DynamicRouteCondition = z.infer<typeof conditionSchema>;
export type DynamicRouteConditionalNode = z.infer<typeof conditionalNodeSchema>;
export type DynamicRoutePercentageNode = z.infer<typeof percentageNodeSchema>;
export type DynamicRouteEndNode = z.infer<typeof endNodeSchema>;
export type DynamicRouteNode = z.infer<typeof nodeSchema>;

function collectNodeReferences(node: DynamicRouteNode): string[] {
	switch (node.type) {
		case "conditional":
			return [...node.conditions.map((c) => c.next), node.else];
		case "percentage":
			return node.splits.map((s) => s.next);
		default:
			return [];
	}
}

export const dynamicRouteGraphSchema = z
	.object({
		entry: nodeIdSchema,
		nodes: z.array(nodeSchema).min(1).max(DYNAMIC_ROUTE_MAX_NODES),
	})
	.superRefine((graph, ctx) => {
		const ids = new Set<string>();
		for (let index = 0; index < graph.nodes.length; index++) {
			const node = graph.nodes[index];
			if (ids.has(node.id)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Duplicate node id "${node.id}"`,
					path: ["nodes", index, "id"],
				});
			}
			ids.add(node.id);
		}
		if (!ids.has(graph.entry)) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Entry node "${graph.entry}" does not exist`,
				path: ["entry"],
			});
		}
		for (let index = 0; index < graph.nodes.length; index++) {
			const node = graph.nodes[index];
			for (const ref of collectNodeReferences(node)) {
				if (!ids.has(ref)) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Node "${node.id}" references unknown node "${ref}"`,
						path: ["nodes", index],
					});
				}
			}
			if (node.type === "model") {
				const modelDef = models.find((m) => m.id === node.model);
				if (!modelDef) {
					if (!parseCustomDynamicRouteModelRef(node.model)) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `Node "${node.id}": unknown model "${node.model}"`,
							path: ["nodes", index, "model"],
						});
					} else if (node.providers) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `Node "${node.id}": custom model "${node.model}" already fixes its provider`,
							path: ["nodes", index, "providers"],
						});
					}
					continue;
				}
				for (const providerId of node.providers ?? []) {
					if (!providers.some((p) => p.id === providerId)) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `Node "${node.id}": unknown provider "${providerId}"`,
							path: ["nodes", index, "providers"],
						});
					} else if (
						!modelDef.providers.some((p) => p.providerId === providerId)
					) {
						ctx.addIssue({
							code: z.ZodIssueCode.custom,
							message: `Node "${node.id}": provider "${providerId}" does not serve model "${node.model}"`,
							path: ["nodes", index, "providers"],
						});
					}
				}
			}
		}
		// Every node must be reachable from the entry so stale branches cannot
		// silently linger in a published graph.
		const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
		const reachable = new Set<string>();
		const queue = [graph.entry];
		while (queue.length > 0) {
			const id = queue.pop()!;
			if (reachable.has(id)) {
				continue;
			}
			reachable.add(id);
			const node = nodesById.get(id);
			if (node) {
				queue.push(...collectNodeReferences(node));
			}
		}
		for (let index = 0; index < graph.nodes.length; index++) {
			const node = graph.nodes[index];
			if (!reachable.has(node.id)) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Node "${node.id}" is not reachable from the entry node`,
					path: ["nodes", index],
				});
			}
		}
		// Reject cycles outright: evaluation is deterministic per request (a
		// revisited conditional or percentage node always takes the same branch
		// again), so any cycle would spin until the hop bound and 400 at request
		// time. Fail at save/publish time instead.
		const visiting = new Set<string>();
		const done = new Set<string>();
		const detectCycle = (id: string): string | undefined => {
			if (done.has(id)) {
				return undefined;
			}
			if (visiting.has(id)) {
				return id;
			}
			visiting.add(id);
			const node = nodesById.get(id);
			if (node) {
				for (const ref of collectNodeReferences(node)) {
					const cycleNode = detectCycle(ref);
					if (cycleNode !== undefined) {
						return cycleNode;
					}
				}
			}
			visiting.delete(id);
			done.add(id);
			return undefined;
		};
		const cycleNode = detectCycle(graph.entry);
		if (cycleNode !== undefined) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Graph contains a cycle through node "${cycleNode}"`,
				path: ["nodes"],
			});
		}
	});

export type DynamicRouteGraph = z.infer<typeof dynamicRouteGraphSchema>;

/**
 * Returns the route name when the model input invokes a dynamic route
 * (e.g. "dynamic/support" -> "support"), or undefined otherwise.
 */
export function parseDynamicRouteModel(modelInput: string): string | undefined {
	if (!modelInput.startsWith(DYNAMIC_ROUTE_PREFIX)) {
		return undefined;
	}
	return modelInput.slice(DYNAMIC_ROUTE_PREFIX.length);
}
