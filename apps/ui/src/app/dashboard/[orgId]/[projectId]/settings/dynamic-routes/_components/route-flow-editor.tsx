"use client";

import {
	Background,
	Controls,
	Handle,
	Position,
	ReactFlow,
	ReactFlowProvider,
	useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Trash2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ModelSelector } from "@/components/models/playground-model-selector";
import { useCustomProviderSelection } from "@/hooks/useCustomProviders";
import { Button } from "@/lib/components/button";
import { Input } from "@/lib/components/input";
import { Label } from "@/lib/components/label";

import {
	type ModelDefinition,
	models as modelCatalog,
	type ProviderDefinition,
	providers as providerDefinitions,
} from "@llmgateway/models";
import {
	MultiProviderSelector,
	type SelectableProviderOption,
} from "@llmgateway/shared/components";
import {
	DYNAMIC_ROUTE_METADATA_PATHS,
	type DynamicRouteCondition,
	type DynamicRouteGraph,
	type DynamicRouteNode,
} from "@llmgateway/shared/dynamic-route";

import {
	createNode,
	editorToGraph,
	type EditorState,
	graphToEditor,
	removeNodes,
	setBranchTarget,
	START_NODE_ID,
	uniqueNodeId,
	validateEditorState,
} from "./flow-graph";

import type {
	Connection,
	Edge,
	EdgeChange,
	Node as FlowNode,
	NodeChange,
} from "@xyflow/react";

const models = modelCatalog as readonly ModelDefinition[];

const SELECTABLE_MODELS = models.filter(
	(m) =>
		m.id !== "auto" &&
		m.id !== "custom" &&
		(!m.output || m.output.includes("text")),
);

const NODE_TYPE_LABELS: Record<DynamicRouteNode["type"], string> = {
	model: "Model",
	conditional: "Conditional",
	percentage: "Percentage",
	end: "End",
};

function conditionSummary(condition: DynamicRouteCondition): string {
	const field = `${condition.field.source}.${condition.field.path || "?"}`;
	if (condition.op === "exists") {
		return `${field} exists`;
	}
	const value = Array.isArray(condition.value)
		? `[${condition.value.join(", ")}]`
		: String(condition.value ?? "");
	return `${field} ${condition.op} ${value}`;
}

function branchRowClass(selected?: boolean): string {
	return `relative rounded border px-2 py-1 text-[11px] leading-4 ${
		selected ? "border-primary/50" : "border-border"
	}`;
}

const sourceHandleClass =
	"!h-2.5 !w-2.5 !border-2 !border-background !bg-primary";
const targetHandleClass =
	"!h-2.5 !w-2.5 !border-2 !border-background !bg-muted-foreground";

interface FlowNodeData extends Record<string, unknown> {
	node?: DynamicRouteNode;
}

function StartFlowNode() {
	return (
		<div className="rounded-full border-2 border-primary bg-background px-4 py-2 text-xs font-semibold shadow-sm">
			Start
			<Handle
				type="source"
				position={Position.Right}
				id="entry"
				className={sourceHandleClass}
			/>
		</div>
	);
}

function nodeCardClass(selected: boolean): string {
	return `min-w-[200px] max-w-[240px] rounded-lg border bg-card px-3 py-2 shadow-sm ${
		selected ? "border-primary ring-1 ring-primary" : "border-border"
	}`;
}

function NodeTitle({ node, label }: { node: DynamicRouteNode; label: string }) {
	return (
		<div className="mb-1 flex items-baseline justify-between gap-2">
			<span className="text-xs font-semibold">{label}</span>
			<span className="truncate text-[10px] text-muted-foreground">
				{node.id}
			</span>
		</div>
	);
}

function ModelFlowNode({
	data,
	selected,
}: {
	data: FlowNodeData;
	selected?: boolean;
}) {
	const node = data.node as Extract<DynamicRouteNode, { type: "model" }>;
	return (
		<div className={nodeCardClass(Boolean(selected))}>
			<Handle
				type="target"
				position={Position.Left}
				id="in"
				className={targetHandleClass}
			/>
			<NodeTitle node={node} label="Model" />
			<div className="text-xs font-medium">
				{node.model || <span className="text-destructive">no model set</span>}
			</div>
			{node.providers && node.providers.length > 0 ? (
				<div className="mt-1 text-[10px] text-muted-foreground">
					fallback order: {node.providers.join(" → ")}
				</div>
			) : (
				<div className="mt-1 text-[10px] text-muted-foreground">
					all providers, smart routing
				</div>
			)}
		</div>
	);
}

function ConditionalFlowNode({
	data,
	selected,
}: {
	data: FlowNodeData;
	selected?: boolean;
}) {
	const node = data.node as Extract<DynamicRouteNode, { type: "conditional" }>;
	return (
		<div className={nodeCardClass(Boolean(selected))}>
			<Handle
				type="target"
				position={Position.Left}
				id="in"
				className={targetHandleClass}
			/>
			<NodeTitle node={node} label="Conditional" />
			<div className="space-y-1">
				{node.conditions.map((condition, index) => (
					<div key={index} className={branchRowClass(selected)}>
						{conditionSummary(condition)}
						<Handle
							type="source"
							position={Position.Right}
							id={`c${index}`}
							className={sourceHandleClass}
						/>
					</div>
				))}
				<div className={branchRowClass(selected)}>
					else
					<Handle
						type="source"
						position={Position.Right}
						id="else"
						className={sourceHandleClass}
					/>
				</div>
			</div>
		</div>
	);
}

function PercentageFlowNode({
	data,
	selected,
}: {
	data: FlowNodeData;
	selected?: boolean;
}) {
	const node = data.node as Extract<DynamicRouteNode, { type: "percentage" }>;
	const total = node.splits.reduce((sum, s) => sum + s.weight, 0);
	return (
		<div className={nodeCardClass(Boolean(selected))}>
			<Handle
				type="target"
				position={Position.Left}
				id="in"
				className={targetHandleClass}
			/>
			<NodeTitle node={node} label="Percentage" />
			<div className="space-y-1">
				{node.splits.map((split, index) => (
					<div key={index} className={branchRowClass(selected)}>
						{total > 0 ? Math.round((split.weight / total) * 100) : 0}% (weight{" "}
						{split.weight})
						<Handle
							type="source"
							position={Position.Right}
							id={`s${index}`}
							className={sourceHandleClass}
						/>
					</div>
				))}
			</div>
		</div>
	);
}

function EndFlowNode({
	data,
	selected,
}: {
	data: FlowNodeData;
	selected?: boolean;
}) {
	const node = data.node as Extract<DynamicRouteNode, { type: "end" }>;
	return (
		<div className={nodeCardClass(Boolean(selected))}>
			<Handle
				type="target"
				position={Position.Left}
				id="in"
				className={targetHandleClass}
			/>
			<NodeTitle node={node} label="End" />
			<div className="text-[10px] text-muted-foreground">
				reject the request (400)
			</div>
		</div>
	);
}

const NODE_TYPES = {
	start: StartFlowNode,
	model: ModelFlowNode,
	conditional: ConditionalFlowNode,
	percentage: PercentageFlowNode,
	end: EndFlowNode,
};

const DND_MIME = "application/x-dynamic-route-node";

interface RouteFlowEditorProps {
	/** Parsed draft graph the editor initializes from. */
	initialGraph: DynamicRouteGraph;
	onGraphChange: (graph: DynamicRouteGraph) => void;
	onValidationChange: (errors: string[]) => void;
}

function RouteFlowEditorInner({
	initialGraph,
	onGraphChange,
	onValidationChange,
}: RouteFlowEditorProps) {
	const [state, setState] = useState<EditorState>(() =>
		graphToEditor(initialGraph),
	);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const { screenToFlowPosition } = useReactFlow();
	// Follow the app's theme (next-themes class strategy), not the OS setting —
	// colorMode="system" would leave React Flow's chrome light in app dark mode.
	const { resolvedTheme } = useTheme();
	const wrapperRef = useRef<HTMLDivElement>(null);
	const initialSerialized = useRef(JSON.stringify(initialGraph));

	useEffect(() => {
		const graph = editorToGraph(state);
		const serialized = JSON.stringify(graph);
		if (serialized !== initialSerialized.current) {
			initialSerialized.current = serialized;
			onGraphChange(graph);
		}
		onValidationChange(validateEditorState(state));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.entry, state.nodes]);

	const flowNodes: FlowNode<FlowNodeData>[] = useMemo(() => {
		const result: FlowNode<FlowNodeData>[] = [
			{
				id: START_NODE_ID,
				type: "start",
				position: state.startPosition,
				deletable: false,
				data: {},
			},
		];
		for (const { node, position } of state.nodes) {
			result.push({
				id: node.id,
				type: node.type,
				position,
				selected: node.id === selectedId,
				data: { node },
			});
		}
		return result;
	}, [state, selectedId]);

	const flowEdges: Edge[] = useMemo(() => {
		const edges: Edge[] = [];
		if (state.entry) {
			edges.push({
				id: `${START_NODE_ID}->entry`,
				source: START_NODE_ID,
				sourceHandle: "entry",
				target: state.entry,
				targetHandle: "in",
			});
		}
		for (const { node } of state.nodes) {
			if (node.type === "conditional") {
				node.conditions.forEach((condition, index) => {
					if (condition.next) {
						edges.push({
							id: `${node.id}:c${index}`,
							source: node.id,
							sourceHandle: `c${index}`,
							target: condition.next,
							targetHandle: "in",
							label: `#${index + 1}`,
						});
					}
				});
				if (node.else) {
					edges.push({
						id: `${node.id}:else`,
						source: node.id,
						sourceHandle: "else",
						target: node.else,
						targetHandle: "in",
						label: "else",
					});
				}
			}
			if (node.type === "percentage") {
				const total = node.splits.reduce((sum, s) => sum + s.weight, 0);
				node.splits.forEach((split, index) => {
					if (split.next) {
						edges.push({
							id: `${node.id}:s${index}`,
							source: node.id,
							sourceHandle: `s${index}`,
							target: split.next,
							targetHandle: "in",
							label:
								total > 0
									? `${Math.round((split.weight / total) * 100)}%`
									: undefined,
						});
					}
				});
			}
		}
		return edges;
	}, [state]);

	const onNodesChange = useCallback((changes: NodeChange[]) => {
		setState((prev) => {
			let next = prev;
			for (const change of changes) {
				if (change.type === "position" && change.position) {
					if (change.id === START_NODE_ID) {
						next = { ...next, startPosition: change.position };
					} else {
						next = {
							...next,
							nodes: next.nodes.map((n) =>
								n.node.id === change.id
									? { ...n, position: change.position! }
									: n,
							),
						};
					}
				}
				if (change.type === "remove" && change.id !== START_NODE_ID) {
					next = removeNodes(next, [change.id]);
				}
			}
			return next;
		});
		for (const change of changes) {
			if (change.type === "select") {
				setSelectedId((current) =>
					change.selected
						? change.id === START_NODE_ID
							? current
							: change.id
						: current === change.id
							? null
							: current,
				);
			}
			if (change.type === "remove") {
				setSelectedId((current) => (current === change.id ? null : current));
			}
		}
	}, []);

	const onEdgesChange = useCallback((changes: EdgeChange[]) => {
		setState((prev) => {
			let next = prev;
			for (const change of changes) {
				if (change.type === "remove") {
					// Edge ids are `<nodeId>:<handle>`; split on the LAST colon —
					// handles never contain one (schema also restricts node ids).
					const separator = change.id.lastIndexOf(":");
					const [source, handle] =
						separator > -1
							? [change.id.slice(0, separator), change.id.slice(separator + 1)]
							: [START_NODE_ID, "entry"];
					next = setBranchTarget(next, source, handle, "");
				}
			}
			return next;
		});
	}, []);

	const onConnect = useCallback((connection: Connection) => {
		if (!connection.source || !connection.target) {
			return;
		}
		if (
			connection.target === START_NODE_ID ||
			connection.source === connection.target
		) {
			return;
		}
		setState((prev) =>
			setBranchTarget(
				prev,
				connection.source,
				connection.sourceHandle ?? "",
				connection.target,
			),
		);
	}, []);

	const addNode = useCallback(
		(type: DynamicRouteNode["type"], position?: { x: number; y: number }) => {
			setState((prev) => {
				const id = uniqueNodeId(prev, type);
				const stackOffsetX = prev.nodes.length * 40;
				const stackOffsetY = prev.nodes.length * 30;
				const fallbackPosition = {
					x: 120 + stackOffsetX,
					y: 320 + stackOffsetY,
				};
				return {
					...prev,
					nodes: [
						...prev.nodes,
						{
							node: createNode(type, id),
							position: position ?? fallbackPosition,
						},
					],
				};
			});
		},
		[],
	);

	const onDrop = useCallback(
		(event: React.DragEvent) => {
			event.preventDefault();
			const type = event.dataTransfer.getData(DND_MIME);
			// Only accept payloads we set ourselves; anything else dropped onto
			// the canvas must not create a broken node.
			if (!(type in NODE_TYPE_LABELS)) {
				return;
			}
			addNode(
				type as DynamicRouteNode["type"],
				screenToFlowPosition({ x: event.clientX, y: event.clientY }),
			);
		},
		[addNode, screenToFlowPosition],
	);

	const updateNode = useCallback(
		(id: string, updater: (node: DynamicRouteNode) => DynamicRouteNode) => {
			setState((prev) => ({
				...prev,
				nodes: prev.nodes.map((n) =>
					n.node.id === id ? { ...n, node: updater(n.node) } : n,
				),
			}));
		},
		[],
	);

	const selectedNode = state.nodes.find((n) => n.node.id === selectedId)?.node;

	return (
		<div className="flex gap-3">
			<div
				ref={wrapperRef}
				className="h-[480px] flex-1 overflow-hidden rounded-md border"
			>
				<ReactFlow
					nodes={flowNodes}
					edges={flowEdges}
					nodeTypes={NODE_TYPES}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					onDrop={onDrop}
					onDragOver={(event) => {
						event.preventDefault();
						event.dataTransfer.dropEffect = "move";
					}}
					deleteKeyCode={["Backspace", "Delete"]}
					fitView
					colorMode={resolvedTheme === "dark" ? "dark" : "light"}
					proOptions={{ hideAttribution: true }}
				>
					<Background />
					<Controls showInteractive={false} />
				</ReactFlow>
			</div>
			<div className="w-64 shrink-0 space-y-3">
				<div className="rounded-md border p-3">
					<p className="mb-2 text-xs font-semibold">Add node</p>
					<div className="grid grid-cols-2 gap-2">
						{(Object.keys(NODE_TYPE_LABELS) as DynamicRouteNode["type"][]).map(
							(type) => (
								<button
									key={type}
									type="button"
									draggable
									onDragStart={(event) =>
										event.dataTransfer.setData(DND_MIME, type)
									}
									onClick={() => addNode(type)}
									className="cursor-grab rounded border px-2 py-1.5 text-xs hover:bg-accent active:cursor-grabbing"
								>
									{NODE_TYPE_LABELS[type]}
								</button>
							),
						)}
					</div>
					<p className="mt-2 text-[10px] text-muted-foreground">
						Drag onto the canvas or click to add. Connect the round handles to
						wire branches; select a node to edit it.
					</p>
				</div>
				{selectedNode ? (
					<NodeInspector
						node={selectedNode}
						onChange={(updater) => updateNode(selectedNode.id, updater)}
						onDelete={() => {
							setState((prev) => removeNodes(prev, [selectedNode.id]));
							setSelectedId(null);
						}}
					/>
				) : (
					<div className="rounded-md border p-3 text-xs text-muted-foreground">
						Select a node to edit its settings.
					</div>
				)}
			</div>
		</div>
	);
}

function NodeInspector({
	node,
	onChange,
	onDelete,
}: {
	node: DynamicRouteNode;
	onChange: (updater: (node: DynamicRouteNode) => DynamicRouteNode) => void;
	onDelete: () => void;
}) {
	return (
		<div className="space-y-3 rounded-md border p-3">
			<div className="flex items-center justify-between">
				<p className="text-xs font-semibold">
					{NODE_TYPE_LABELS[node.type]} · {node.id}
				</p>
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6"
					aria-label="Delete node"
					onClick={onDelete}
				>
					<Trash2 className="h-3.5 w-3.5 text-destructive" />
				</Button>
			</div>
			{node.type === "model" && (
				<ModelInspector node={node} onChange={onChange} />
			)}
			{node.type === "conditional" && (
				<ConditionalInspector node={node} onChange={onChange} />
			)}
			{node.type === "percentage" && (
				<PercentageInspector node={node} onChange={onChange} />
			)}
			{node.type === "end" && (
				<p className="text-xs text-muted-foreground">
					Requests reaching this node are rejected with a 400.
				</p>
			)}
		</div>
	);
}

function ModelInspector({
	node,
	onChange,
}: {
	node: Extract<DynamicRouteNode, { type: "model" }>;
	onChange: (updater: (node: DynamicRouteNode) => DynamicRouteNode) => void;
}) {
	const { customModelOptions } = useCustomProviderSelection();
	const selectableModels = useMemo(
		() => [...SELECTABLE_MODELS, ...customModelOptions],
		[customModelOptions],
	);
	const modelDef = selectableModels.find((model) => model.id === node.model);
	const isCustomModel = modelDef?.family === "custom";
	// Only providers actually serving the chosen model are selectable; selection
	// order in MultiProviderSelector is the fallback order.
	const selectableProviders: SelectableProviderOption[] =
		modelDef && !isCustomModel
			? Array.from(new Set(modelDef.providers.map((p) => p.providerId))).map(
					(id) => {
						const def = providerDefinitions.find((p) => p.id === id);
						return { id, name: def?.name ?? id, color: def?.color };
					},
				)
			: [];
	return (
		<div className="space-y-2">
			<div className="space-y-1">
				<Label className="text-xs">Model</Label>
				<ModelSelector
					models={selectableModels as ModelDefinition[]}
					providers={providerDefinitions as unknown as ProviderDefinition[]}
					value={node.model}
					onValueChange={(value) => {
						// The selector emits "provider/model[:region]" even in canonicalOnly
						// mode; a model node stores the canonical catalog id — the provider
						// restriction lives in the fallback list below. Preserve exact
						// catalog ids because custom model names may contain colons.
						const withoutProvider = value.includes("/")
							? value.slice(value.indexOf("/") + 1)
							: value;
						const lastColon = withoutProvider.lastIndexOf(":");
						const modelId =
							selectableModels.some((model) => model.id === withoutProvider) ||
							lastColon === -1
								? withoutProvider
								: withoutProvider.slice(0, lastColon);
						onChange((n) =>
							n.type === "model"
								? { ...n, model: modelId, providers: undefined }
								: n,
						);
					}}
					placeholder="Select a model..."
					canonicalOnly
				/>
			</div>
			<div className="space-y-1">
				<Label className="text-xs">Provider fallback order (optional)</Label>
				{isCustomModel ? (
					<p className="text-[10px] text-muted-foreground">
						The custom provider is fixed by this model.
					</p>
				) : modelDef ? (
					<MultiProviderSelector
						providers={selectableProviders}
						selectedProviders={node.providers ?? []}
						onProvidersChange={(selected) =>
							onChange((n) =>
								n.type === "model"
									? {
											...n,
											providers: selected.length > 0 ? selected : undefined,
										}
									: n,
							)
						}
						placeholder="All providers (smart routing)"
					/>
				) : (
					<p className="text-[10px] text-muted-foreground">
						Choose a model first.
					</p>
				)}
				<p className="text-[10px] text-muted-foreground">
					Empty = all providers with weighted smart routing. Listed providers
					restrict routing and are tried in the order selected.
				</p>
			</div>
		</div>
	);
}

function conditionValueText(condition: DynamicRouteCondition): string {
	if (Array.isArray(condition.value)) {
		return condition.value.join(", ");
	}
	return condition.value === undefined ? "" : String(condition.value);
}

function parseConditionValue(
	op: DynamicRouteCondition["op"],
	text: string,
): DynamicRouteCondition["value"] {
	if (op === "exists") {
		return undefined;
	}
	if (op === "in") {
		return text
			.split(",")
			.map((v) => v.trim())
			.filter(Boolean);
	}
	if (op === "gt" || op === "lt") {
		const num = Number(text);
		return Number.isFinite(num) ? num : 0;
	}
	return text;
}

function ConditionalInspector({
	node,
	onChange,
}: {
	node: Extract<DynamicRouteNode, { type: "conditional" }>;
	onChange: (updater: (node: DynamicRouteNode) => DynamicRouteNode) => void;
}) {
	const updateCondition = (
		index: number,
		patch: (c: DynamicRouteCondition) => DynamicRouteCondition,
	) => {
		onChange((n) =>
			n.type === "conditional"
				? {
						...n,
						conditions: n.conditions.map((c, i) =>
							i === index ? patch(c) : c,
						),
					}
				: n,
		);
	};
	return (
		<div className="space-y-2">
			{node.conditions.map((condition, index) => (
				<div key={index} className="space-y-1 rounded border p-2">
					<div className="flex items-center justify-between">
						<span className="text-[11px] font-medium">
							Condition {index + 1}
						</span>
						<button
							type="button"
							aria-label={`Remove condition ${index + 1}`}
							className="text-[11px] text-muted-foreground hover:text-destructive"
							onClick={() =>
								onChange((n) =>
									n.type === "conditional"
										? {
												...n,
												conditions: n.conditions.filter((_, i) => i !== index),
											}
										: n,
								)
							}
						>
							remove
						</button>
					</div>
					<div className="grid grid-cols-2 gap-1">
						<select
							className="h-7 rounded-md border bg-transparent px-1 text-xs"
							value={condition.field.source}
							onChange={(e) =>
								updateCondition(index, (c) => ({
									...c,
									field: {
										source: e.target
											.value as DynamicRouteCondition["field"]["source"],
										path: "",
									},
								}))
							}
						>
							<option value="header">header</option>
							<option value="body">body</option>
							<option value="metadata">metadata</option>
						</select>
						{condition.field.source === "metadata" ? (
							<select
								className="h-7 rounded-md border bg-transparent px-1 text-xs"
								value={condition.field.path}
								onChange={(e) =>
									updateCondition(index, (c) => ({
										...c,
										field: { ...c.field, path: e.target.value },
									}))
								}
							>
								<option value="">field…</option>
								{DYNAMIC_ROUTE_METADATA_PATHS.map((path) => (
									<option key={path} value={path}>
										{path}
									</option>
								))}
							</select>
						) : (
							<Input
								className="h-7 text-xs"
								placeholder={
									condition.field.source === "header"
										? "x-user-tier"
										: "metadata.segment"
								}
								value={condition.field.path}
								onChange={(e) =>
									updateCondition(index, (c) => ({
										...c,
										field: { ...c.field, path: e.target.value },
									}))
								}
							/>
						)}
						<select
							className="h-7 rounded-md border bg-transparent px-1 text-xs"
							value={condition.op}
							onChange={(e) => {
								const op = e.target.value as DynamicRouteCondition["op"];
								updateCondition(index, (c) => ({
									...c,
									op,
									value: parseConditionValue(op, conditionValueText(c)),
								}));
							}}
						>
							{["eq", "neq", "in", "contains", "gt", "lt", "exists"].map(
								(op) => (
									<option key={op} value={op}>
										{op}
									</option>
								),
							)}
						</select>
						{condition.op !== "exists" && (
							<Input
								className="h-7 text-xs"
								placeholder={condition.op === "in" ? "a, b, c" : "value"}
								type={
									condition.op === "gt" || condition.op === "lt"
										? "number"
										: "text"
								}
								value={conditionValueText(condition)}
								onChange={(e) =>
									updateCondition(index, (c) => ({
										...c,
										value: parseConditionValue(c.op, e.target.value),
									}))
								}
							/>
						)}
					</div>
				</div>
			))}
			<Button
				variant="outline"
				size="sm"
				className="h-7 w-full text-xs"
				onClick={() =>
					onChange((n) =>
						n.type === "conditional"
							? {
									...n,
									conditions: [
										...n.conditions,
										{
											field: { source: "header", path: "" },
											op: "eq",
											value: "",
											next: "",
										},
									],
								}
							: n,
					)
				}
			>
				Add condition
			</Button>
			<p className="text-[10px] text-muted-foreground">
				Conditions are evaluated top to bottom; the first match wins. Wire each
				condition&apos;s handle (and the else handle) on the canvas.
			</p>
		</div>
	);
}

function PercentageInspector({
	node,
	onChange,
}: {
	node: Extract<DynamicRouteNode, { type: "percentage" }>;
	onChange: (updater: (node: DynamicRouteNode) => DynamicRouteNode) => void;
}) {
	const total = node.splits.reduce((sum, s) => sum + s.weight, 0);
	return (
		<div className="space-y-2">
			{node.splits.map((split, index) => (
				<div key={index} className="flex items-center gap-2">
					<Input
						className="h-7 w-20 text-xs"
						type="number"
						min={0.0001}
						value={split.weight}
						onChange={(e) => {
							const weight = Number(e.target.value);
							onChange((n) =>
								n.type === "percentage"
									? {
											...n,
											splits: n.splits.map((s, i) =>
												i === index
													? {
															...s,
															weight: Number.isFinite(weight) ? weight : 0,
														}
													: s,
											),
										}
									: n,
							);
						}}
					/>
					<span className="flex-1 text-[11px] text-muted-foreground">
						≈ {total > 0 ? Math.round((split.weight / total) * 100) : 0}%
					</span>
					{node.splits.length > 2 && (
						<button
							type="button"
							aria-label={`Remove split ${index + 1}`}
							className="text-[11px] text-muted-foreground hover:text-destructive"
							onClick={() =>
								onChange((n) =>
									n.type === "percentage"
										? {
												...n,
												splits: n.splits.filter((_, i) => i !== index),
											}
										: n,
								)
							}
						>
							remove
						</button>
					)}
				</div>
			))}
			<Button
				variant="outline"
				size="sm"
				className="h-7 w-full text-xs"
				onClick={() =>
					onChange((n) =>
						n.type === "percentage"
							? { ...n, splits: [...n.splits, { weight: 10, next: "" }] }
							: n,
					)
				}
			>
				Add split
			</Button>
			<p className="text-[10px] text-muted-foreground">
				Weights are relative; splits are deterministic per session so a
				conversation keeps its assignment.
			</p>
		</div>
	);
}

export function RouteFlowEditor(props: RouteFlowEditorProps) {
	return (
		<ReactFlowProvider>
			<RouteFlowEditorInner {...props} />
		</ReactFlowProvider>
	);
}
