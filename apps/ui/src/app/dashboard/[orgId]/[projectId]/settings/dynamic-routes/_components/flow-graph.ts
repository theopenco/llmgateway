import { dynamicRouteGraphSchema } from "@llmgateway/shared/dynamic-route";

import type {
	DynamicRouteGraph,
	DynamicRouteNode,
} from "@llmgateway/shared/dynamic-route";

export const START_NODE_ID = "__start__";

export interface EditorPosition {
	x: number;
	y: number;
}

export interface EditorNode {
	node: DynamicRouteNode;
	position: EditorPosition;
}

/**
 * Editable state behind the visual editor. The React Flow edges are derived
 * from the branch targets stored inside each node (`next`, `else`, split
 * targets) plus `entry`; an unconnected branch is the empty string.
 */
export interface EditorState {
	entry: string;
	startPosition: EditorPosition;
	nodes: EditorNode[];
}

export function nodeReferences(node: DynamicRouteNode): string[] {
	switch (node.type) {
		case "conditional":
			return [...node.conditions.map((c) => c.next), node.else];
		case "percentage":
			return node.splits.map((s) => s.next);
		default:
			return [];
	}
}

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 150;
const ORIGIN_X = 40;
const ORIGIN_Y = 40;

/**
 * Deterministic layered layout: BFS depth from the entry node decides the
 * column, discovery order decides the row. Unreachable nodes go into the
 * column after the deepest reachable one.
 */
export function graphToEditor(graph: DynamicRouteGraph): EditorState {
	const depths = new Map<string, number>();
	const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
	const queue: { id: string; depth: number }[] = graph.entry
		? [{ id: graph.entry, depth: 0 }]
		: [];
	while (queue.length > 0) {
		const { id, depth } = queue.shift()!;
		if (depths.has(id)) {
			continue;
		}
		depths.set(id, depth);
		const node = nodesById.get(id);
		if (node) {
			for (const ref of nodeReferences(node)) {
				if (ref && !depths.has(ref)) {
					queue.push({ id: ref, depth: depth + 1 });
				}
			}
		}
	}
	const maxDepth = Math.max(0, ...Array.from(depths.values()));
	const rowsPerColumn = new Map<number, number>();
	const nodes: EditorNode[] = graph.nodes.map((node) => {
		const depth = depths.get(node.id) ?? maxDepth + 1;
		const row = rowsPerColumn.get(depth) ?? 0;
		rowsPerColumn.set(depth, row + 1);
		const columnOffset = (depth + 1) * COLUMN_WIDTH;
		const rowOffset = row * ROW_HEIGHT;
		return {
			node,
			position: {
				x: ORIGIN_X + columnOffset,
				y: ORIGIN_Y + rowOffset,
			},
		};
	});
	return {
		entry: graph.entry,
		startPosition: { x: ORIGIN_X, y: ORIGIN_Y },
		nodes,
	};
}

export function editorToGraph(state: EditorState): DynamicRouteGraph {
	return {
		entry: state.entry,
		nodes: state.nodes.map((n) => n.node),
	} as DynamicRouteGraph;
}

/**
 * Human-readable validation. Structural problems (unconnected branches,
 * unset fields) are reported directly; once those pass, the shared Zod
 * schema provides catalog-level checks (unknown model, cycles, ...).
 */
export function validateEditorState(state: EditorState): string[] {
	const errors: string[] = [];
	if (state.nodes.length === 0) {
		return ["Add at least one node"];
	}
	if (!state.entry) {
		errors.push("Connect the Start node to the first node of the flow");
	}
	for (const { node } of state.nodes) {
		if (node.type === "model" && !node.model) {
			errors.push(`Model node "${node.id}": choose a model`);
		}
		if (node.type === "conditional") {
			node.conditions.forEach((condition, index) => {
				if (!condition.field.path) {
					errors.push(
						`Conditional "${node.id}": condition ${index + 1} needs a field path`,
					);
				}
				if (!condition.next) {
					errors.push(
						`Conditional "${node.id}": connect condition ${index + 1} to a node`,
					);
				}
			});
			if (!node.else) {
				errors.push(`Conditional "${node.id}": connect the else branch`);
			}
		}
		if (node.type === "percentage") {
			node.splits.forEach((split, index) => {
				if (!split.next) {
					errors.push(
						`Percentage "${node.id}": connect split ${index + 1} to a node`,
					);
				}
			});
		}
	}
	if (errors.length > 0) {
		return errors;
	}
	const parsed = dynamicRouteGraphSchema.safeParse(editorToGraph(state));
	if (!parsed.success) {
		return parsed.error.issues.map((issue) => issue.message);
	}
	return [];
}

/** Validates raw JSON text; returns friendly errors (empty = valid). */
export function validateGraphText(text: string): string[] {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (error) {
		return [
			`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
		];
	}
	const parsed = dynamicRouteGraphSchema.safeParse(raw);
	if (!parsed.success) {
		return parsed.error.issues.map(
			(issue) =>
				`${issue.path.length > 0 ? `${issue.path.join(".")}: ` : ""}${issue.message}`,
		);
	}
	return [];
}

export function uniqueNodeId(state: EditorState, type: string): string {
	const existing = new Set(state.nodes.map((n) => n.node.id));
	let index = 1;
	while (existing.has(`${type}-${index}`)) {
		index++;
	}
	return `${type}-${index}`;
}

export function createNode(
	type: DynamicRouteNode["type"],
	id: string,
): DynamicRouteNode {
	switch (type) {
		case "model":
			return { id, type: "model", model: "" };
		case "conditional":
			return {
				id,
				type: "conditional",
				conditions: [
					{
						field: { source: "header", path: "" },
						op: "eq",
						value: "",
						next: "",
					},
				],
				else: "",
			};
		case "percentage":
			return {
				id,
				type: "percentage",
				splits: [
					{ weight: 50, next: "" },
					{ weight: 50, next: "" },
				],
			};
		case "end":
			return { id, type: "end" };
	}
}

/** Removes nodes and clears every branch (and entry) that pointed at them. */
export function removeNodes(state: EditorState, ids: string[]): EditorState {
	const removed = new Set(ids);
	const clearRef = (ref: string) => (removed.has(ref) ? "" : ref);
	return {
		...state,
		entry: clearRef(state.entry),
		nodes: state.nodes
			.filter((n) => !removed.has(n.node.id))
			.map(({ node, position }) => {
				if (node.type === "conditional") {
					return {
						position,
						node: {
							...node,
							conditions: node.conditions.map((c) => ({
								...c,
								next: clearRef(c.next),
							})),
							else: clearRef(node.else),
						},
					};
				}
				if (node.type === "percentage") {
					return {
						position,
						node: {
							...node,
							splits: node.splits.map((s) => ({
								...s,
								next: clearRef(s.next),
							})),
						},
					};
				}
				return { node, position };
			}),
	};
}

/**
 * Sets the branch identified by a React Flow source handle to `target`
 * (empty string disconnects). Handle ids: "entry" on the start node,
 * "c<i>" / "else" on conditionals, "s<i>" on percentage nodes.
 */
export function setBranchTarget(
	state: EditorState,
	sourceId: string,
	sourceHandle: string,
	target: string,
): EditorState {
	if (sourceId === START_NODE_ID) {
		return { ...state, entry: target };
	}
	return {
		...state,
		nodes: state.nodes.map(({ node, position }) => {
			if (node.id !== sourceId) {
				return { node, position };
			}
			if (node.type === "conditional") {
				if (sourceHandle === "else") {
					return { position, node: { ...node, else: target } };
				}
				const index = Number(sourceHandle.slice(1));
				return {
					position,
					node: {
						...node,
						conditions: node.conditions.map((c, i) =>
							i === index ? { ...c, next: target } : c,
						),
					},
				};
			}
			if (node.type === "percentage") {
				const index = Number(sourceHandle.slice(1));
				return {
					position,
					node: {
						...node,
						splits: node.splits.map((s, i) =>
							i === index ? { ...s, next: target } : s,
						),
					},
				};
			}
			return { node, position };
		}),
	};
}
