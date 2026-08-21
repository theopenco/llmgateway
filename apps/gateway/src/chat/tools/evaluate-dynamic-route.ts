import {
	DYNAMIC_ROUTE_MAX_HOPS,
	type DynamicRouteCondition,
	type DynamicRouteGraph,
	type DynamicRouteNode,
} from "@llmgateway/shared/dynamic-route";

export interface DynamicRouteEvaluationContext {
	getHeader: (name: string) => string | undefined;
	/**
	 * The RAW parsed request body as sent by the caller (not the
	 * schema-validated copy, which strips unknown keys and would hide
	 * caller-defined routing fields like "metadata.segment").
	 */
	body: Record<string, unknown>;
	metadata: {
		orgId: string;
		projectId: string;
		apiKeyId: string;
		plan: string;
	};
	/**
	 * Stable key for deterministic percentage splits. Sessions (x-session-id
	 * etc.) keep their A/B assignment across requests; without a session the
	 * per-request id yields an independent draw per request.
	 */
	splitKey: string;
}

export type DynamicRouteEvaluation =
	| {
			status: "model";
			model: string;
			providers?: string[];
			/** Node ids traversed, for routing metadata / observability. */
			path: string[];
	  }
	| { status: "end"; path: string[] };

export class DynamicRouteEvaluationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DynamicRouteEvaluationError";
	}
}

/**
 * FNV-1a 32-bit hash. Deterministic and dependency-free; used to bucket the
 * split key into percentage branches. The node id is mixed in so multiple
 * percentage nodes in one graph don't produce perfectly correlated draws.
 */
function fnv1a(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function resolveFieldValue(
	condition: DynamicRouteCondition,
	ctx: DynamicRouteEvaluationContext,
): unknown {
	const { source, path } = condition.field;
	switch (source) {
		case "header":
			return ctx.getHeader(path);
		case "metadata": {
			// Own-property check so prototype keys (e.g. "constructor") never
			// resolve; the schema also restricts metadata paths to a fixed set.
			const metadata = ctx.metadata as Record<string, unknown>;
			return Object.prototype.hasOwnProperty.call(metadata, path)
				? metadata[path]
				: undefined;
		}
		case "body": {
			let current: unknown = ctx.body;
			for (const segment of path.split(".")) {
				if (
					current === null ||
					typeof current !== "object" ||
					!Object.prototype.hasOwnProperty.call(current, segment)
				) {
					return undefined;
				}
				current = (current as Record<string, unknown>)[segment];
			}
			return current;
		}
	}
}

function matchesCondition(
	condition: DynamicRouteCondition,
	ctx: DynamicRouteEvaluationContext,
): boolean {
	const actual = resolveFieldValue(condition, ctx);
	if (condition.op === "exists") {
		return actual !== undefined && actual !== null;
	}
	if (actual === undefined || actual === null) {
		// A missing field only ever satisfies "neq" — it is trivially not equal.
		return condition.op === "neq";
	}
	if (typeof actual === "object") {
		return false;
	}
	switch (condition.op) {
		case "eq":
			return String(actual) === String(condition.value);
		case "neq":
			return String(actual) !== String(condition.value);
		case "in":
			return (
				Array.isArray(condition.value) &&
				condition.value.some((v) => String(v) === String(actual))
			);
		case "contains":
			return String(actual).includes(String(condition.value));
		case "gt": {
			const num = Number(actual);
			return Number.isFinite(num) && num > (condition.value as number);
		}
		case "lt": {
			const num = Number(actual);
			return Number.isFinite(num) && num < (condition.value as number);
		}
	}
}

function pickPercentageBranch(
	node: Extract<DynamicRouteNode, { type: "percentage" }>,
	ctx: DynamicRouteEvaluationContext,
): string {
	const total = node.splits.reduce((sum, split) => sum + split.weight, 0);
	const draw = (fnv1a(`${ctx.splitKey}:${node.id}`) / 0x100000000) * total;
	let cumulative = 0;
	for (const split of node.splits) {
		cumulative += split.weight;
		if (draw < cumulative) {
			return split.next;
		}
	}
	return node.splits[node.splits.length - 1].next;
}

/**
 * Walks a validated dynamic-route graph and resolves it to a target model
 * (with an optional provider restriction) or an explicit end.
 *
 * @throws DynamicRouteEvaluationError when the graph references an unknown
 * node or exceeds the hop bound.
 */
export function evaluateDynamicRoute(
	graph: DynamicRouteGraph,
	ctx: DynamicRouteEvaluationContext,
): DynamicRouteEvaluation {
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	const path: string[] = [];
	let currentId = graph.entry;

	for (let hops = 0; hops < DYNAMIC_ROUTE_MAX_HOPS; hops++) {
		const node = nodesById.get(currentId);
		if (!node) {
			throw new DynamicRouteEvaluationError(
				`references unknown node "${currentId}"`,
			);
		}
		path.push(node.id);
		switch (node.type) {
			case "model":
				return {
					status: "model",
					model: node.model,
					providers: node.providers,
					path,
				};
			case "end":
				return { status: "end", path };
			case "conditional": {
				const matched = node.conditions.find((condition) =>
					matchesCondition(condition, ctx),
				);
				currentId = matched ? matched.next : node.else;
				break;
			}
			case "percentage":
				currentId = pickPercentageBranch(node, ctx);
				break;
		}
	}
	throw new DynamicRouteEvaluationError(
		`exceeded the maximum of ${DYNAMIC_ROUTE_MAX_HOPS} nodes per evaluation`,
	);
}
